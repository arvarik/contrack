import { facetNeedle, type FacetFilter } from "../../shared/searchFacets.ts";
import {
  formatFacetQuery,
  parseFacetQuery,
  type RefineOption,
} from "../../shared/facetQuery.ts";
import { refineOptions } from "./search/refine.ts";
import { sqlite } from "../db.ts";
import { selectPassages, currentPassage } from "./search/passages.ts";
import { findPassageNeighbors } from "./search/localEmbeddings.ts";
import { lexicalSearch, type LexicalMatch } from "./search/lexical.ts";
import { ACTIVE_CONTACT_SQL } from "./search/ftsIndex.ts";
import { log } from "../utils/logger.ts";
import {
  contactRepo,
  type RawContactRow,
} from "../repositories/contactRepository.ts";
import type { Scope } from "../tenancy/scope.ts";
import { rerankCandidates, type CompressedContact } from "../ai/aiService.ts";
import type { QueryPlan, SemanticMatchResult } from "../ai/types.ts";
import {
  getCachedSearch,
  setCachedSearch,
  normalizeKey,
} from "../utils/aiCache.ts";
import {
  embedQuery,
  hybridRetrieval,
  localRetrieval,
  queryIntent,
  type AllowedContact,
  type RetrievalResult,
} from "./search/hybridRetrieval.ts";
import {
  entityKey,
  constraintKey,
  getSemanticAnswer,
  setSemanticAnswer,
  type SemanticKey,
} from "./search/semanticCache.ts";
import { resolveEmbeddings } from "../ai/embeddings.ts";
import { buildReason, type ReasonEvidence } from "./search/reasons.ts";
import {
  explainMatch,
  questionTerms,
  type MatchProof,
  type QuestionTerms,
} from "./search/matchedOn.ts";
import type { MatchedOn } from "../../shared/matchedOn.ts";
import type { SearchPassage } from "./search/passages.ts";
import {
  compileFacets,
  facetKey,
  type CompiledFacets,
} from "./search/facetSql.ts";
import {
  findImplicitFacets,
  hasContentWords,
} from "./search/implicitFacets.ts";
import {
  isCrossEncoderReady,
  RERANK_CANDIDATES,
  rerankBudgetMs,
  rerankLocal,
  profileText,
  rerankModel,
  type RerankOptions,
} from "./search/crossEncoder.ts";
import type { Response } from "express";
import { getErrorMessage } from "../utils/helpers.ts";
import { resolveCapability } from "../ai/capabilities.ts";
import { isMockMode } from "../ai/services/shared.ts";
import { withTimeout } from "../ai/resilience.ts";
import { RequestCoalescer } from "../utils/requestCoalescer.ts";

export const searchCoalescer = new RequestCoalescer();

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum candidates to hydrate and send in Phase 1.
 * Keeps the instant payload small (~30 full contact objects ≈ 40KB)
 * while still providing comprehensive results.
 */
const PHASE1_LIMIT = 30;

/**
 * Maximum candidates sent to the LLM reranker.
 * Matches PHASE1_LIMIT — the reranker evaluates the same top set.
 */
const RERANKER_LIMIT = 30;

/** The model stages together: the planner, then the reranker when it runs. */
const MODEL_BUDGET_MS = 12_000;

// =============================================================================
// Types
// =============================================================================

/**
 * A fully hydrated contact row with an optional server-built reason.
 *
 * Uses `Record<string, unknown>` rather than `[key: string]: any` to
 * prevent silent `any`-propagation through the type system. The dynamic
 * shape comes from `contactRepo.hydrate()` which returns a plain object.
 */
export type HydratedMatch = Record<string, unknown> & {
  id: string;
  name: string;
  aiReason?: string | null;
  approximate?: boolean;
  matchType?: "exact" | "approximate";
  /**
   * True when local search answered exactly (a name, an email, a phone) or
   * when the database filter or the reranker proved the match. False for a
   * local result nobody has checked yet.
   */
  verified?: boolean;
  /** The fields that answer the question, for the card (`matchedOn.ts`). */
  matchedOn?: MatchedOn[];
};

/** Options for one Ask Contrack search. */
export interface SemanticSearchOptions {
  /**
   * False when the caller has switched AI off: every model stage is skipped
   * and the local list is the answer.
   */
  aiAllowed?: boolean;
  /**
   * Facets the request carries, as the palette sends its pills. Facets typed
   * into the question are read from it as well.
   */
  filters?: FacetFilter[];
  /** The fusion constant. `RRF_K` when unset. The benchmark's k sweep sets it. */
  rrfK?: number;
  /**
   * False skips the local cross-encoder. The search gate measures the local
   * list both ways, and the benchmark names a model and a candidate count.
   */
  crossEncoder?: boolean | RerankOptions;
}

// =============================================================================
// Shared Helpers (DRY — used by both streaming and non-streaming paths)
// =============================================================================

/**
 * The JavaScript form of ACTIVE_CONTACT_SQL, for rows a scoped finder returned.
 *
 * `findManyOwned` answers "does this owner own these ids" and nothing else, so
 * the visibility gate is applied here instead. Each test matches its SQL twin
 * exactly: `isGhost = 0` is false for a NULL, and `COALESCE(isArchived, 0) = 0`
 * is true for one.
 */
function isActiveContact(row: RawContactRow): boolean {
  return (
    row.isGhost === 0 &&
    !row.isArchived &&
    row.canonicalId == null &&
    row.deletedAt == null
  );
}

/**
 * Hydrate a list of contact IDs into full contact objects with `aiReason: null`.
 * Returns a Map keyed by contactId for O(1) lookup.
 */
function hydrateCandidates(
  scope: Scope,
  candidateIds: string[],
  limit: number,
): Map<string, HydratedMatch> {
  const hydratedMap = new Map<string, HydratedMatch>();
  const topIds = candidateIds.slice(0, limit);
  if (!topIds.length) return hydratedMap;

  // One chunked IN(...) query + bulk hydration — this is the search hot path,
  // and per-id hydrate() here previously cost ~13 queries per candidate. The
  // finder puts the owner and the ids in the same statement, so a candidate id
  // that belongs to somebody else is dropped at the index.
  const rows = contactRepo.findManyOwned(scope, topIds).filter(isActiveContact);
  const hydratedRows = contactRepo.hydrateMany(rows);
  const byId = new Map(hydratedRows.map((r) => [r.id, r]));

  // Preserve the ranked candidate order.
  for (const id of topIds) {
    const hydrated = byId.get(id);
    if (!hydrated) continue;
    hydratedMap.set(id, { ...hydrated, id, aiReason: null });
  }

  return hydratedMap;
}

/** Keyword matches as contacts, each marked exact or approximate. */
function hydrateLexical(
  scope: Scope,
  matches: LexicalMatch[],
  limit: number,
): HydratedMatch[] {
  const hydratedMap = hydrateCandidates(
    scope,
    matches.map((row) => row.contactId),
    limit,
  );
  return matches.flatMap((m) => {
    const contact = hydratedMap.get(m.contactId);
    if (!contact) return [];
    return [
      {
        ...contact,
        approximate: Boolean(m.approximate),
        matchType: m.approximate
          ? ("approximate" as const)
          : ("exact" as const),
      },
    ];
  });
}

/** The same facets once each, whether typed, sent as a pill, or both. */
function uniqueFacets(filters: FacetFilter[]): FacetFilter[] {
  const seen = new Set<string>();
  return filters.filter((filter) => {
    const key = facetKey([filter]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Evidence a database filter proved. */
const filterProofs = (evidence: ReasonEvidence[]): MatchProof[] =>
  evidence.map((item) => ({ evidence: item, how: "filter" }));

/**
 * Each match with the fields that answer the question. `proofsOf` gives the
 * fields a filter or the reranker proved, and `passagesOf` the passages the
 * search read for the contact, for a match nothing else explains.
 */
function withMatchedOn<T extends HydratedMatch>(
  matches: T[],
  terms: QuestionTerms,
  proofsOf: (match: T) => MatchProof[] = () => [],
  passagesOf: (match: T) => SearchPassage[] = () => [],
): T[] {
  const now = new Date();
  return matches.map((match) => ({
    ...match,
    matchedOn: explainMatch(
      match,
      terms,
      proofsOf(match),
      passagesOf(match),
      now,
    ),
  }));
}

/**
 * What the facets prove about a contact, as reason evidence. A facet on a
 * score, a date of edit, a list, a distance or a missing field says nothing
 * a reason line would show.
 */
function facetEvidence(
  contact: HydratedMatch,
  filters: FacetFilter[],
): ReasonEvidence[] {
  const evidence: ReasonEvidence[] = [];
  for (const filter of filters) {
    switch (filter.field) {
      case "role":
      case "company":
      case "location":
      case "industry":
        evidence.push({ field: filter.field });
        break;
      case "tag": {
        const needle = facetNeedle(filter);
        const tags = Array.isArray(contact.tags) ? contact.tags : [];
        const tag = tags.find(
          (item) =>
            typeof item?.tag === "string" &&
            item.tag.toLowerCase().includes(needle),
        )?.tag;
        if (tag) evidence.push({ field: "tag", value: tag });
        break;
      }
      case "contacted":
        evidence.push({ field: "lastContact" });
        break;
    }
  }
  return evidence;
}

/**
 * The facets as the Network list's query, `/?q=<this>`, or undefined when
 * the query would read back as another set. A `near:` reads back without the
 * point the server found for its place, and the list reads no `near:`. A
 * value the query syntax cannot hold reads back as another filter.
 */
function networkQuery(filters: FacetFilter[]): string | undefined {
  const query = formatFacetQuery(filters);
  return facetKey(parseFacetQuery(query).filters) === facetKey(filters)
    ? query
    : undefined;
}

/**
 * The answer to a question that is only facets: the matching contacts in
 * name order, proved by the database, with no model call.
 */
function facetAnswer(
  scope: Scope,
  facets: CompiledFacets,
  filters: FacetFilter[],
  terms: QuestionTerms,
): SearchResult {
  const matching = `${ACTIVE_CONTACT_SQL} AND (${facets.sql})`;
  const params = [scope.ownerId, ...facets.params];
  const ids = (
    sqlite
      .prepare(
        `SELECT c.id FROM contacts c WHERE c.ownerId = ? AND ${matching}
         ORDER BY c.name COLLATE NOCASE, c.id LIMIT ?`,
      )
      .all(...params, PHASE1_LIMIT) as { id: string }[]
  ).map((row) => row.id);
  // "Who do I track?" can hold thousands, and the list shows the first few.
  // A full list is counted, so the page can say how many there are.
  const total =
    ids.length < PHASE1_LIMIT
      ? ids.length
      : (
          sqlite
            .prepare(
              `SELECT COUNT(*) AS n FROM contacts c WHERE c.ownerId = ? AND ${matching}`,
            )
            .get(...params) as { n: number }
        ).n;
  return {
    total,
    facets: networkQuery(filters),
    // A cut list offers the facets that split it.
    ...(total > ids.length
      ? { refine: refineOptions(scope, filters, total) }
      : {}),
    matches: withMatchedOn(
      [...hydrateCandidates(scope, ids, PHASE1_LIMIT).values()].map(
        (contact) => ({
          ...contact,
          verified: true,
          aiReason: buildReason(contact, facetEvidence(contact, filters)),
        }),
      ),
      terms,
      (contact) => filterProofs(facetEvidence(contact, filters)),
    ),
    fallback: false,
  };
}

/** A contact's addresses as text, in their order. */
const addressesOf = (contact: HydratedMatch): string[] =>
  (Array.isArray(contact.addresses) ? contact.addresses : [])
    .map((entry: { address?: unknown }) => entry?.address)
    .filter((address): address is string => typeof address === "string");

/**
 * Build compressed contact profiles for the LLM reranker.
 * Strips heavy fields (avatar, timestamps, child arrays) to minimize token usage.
 */
function buildCompressedCandidates(
  matches: HydratedMatch[],
  scope: Scope,
  query: string,
  queryVector?: Float32Array | null,
): CompressedContact[] {
  const selected = selectPassages(
    scope,
    query,
    matches.map((match) => match.id),
    queryVector
      ? findPassageNeighbors(
          scope,
          queryVector,
          new Set(matches.map((match) => match.id)),
        )
      : [],
  );
  const compressed: CompressedContact[] = [];
  let size = 2;
  for (const match of matches.slice(0, RERANKER_LIMIT)) {
    const entry: CompressedContact = {
      id: match.id,
      name: match.name.slice(0, 160),
    };
    for (const field of [
      "headline",
      "role",
      "company",
      "location",
      "about",
      "industry",
      "preferences",
    ] as const) {
      if (typeof match[field] === "string")
        entry[field] = match[field].slice(0, field === "about" ? 500 : 200);
    }
    const tags = Array.isArray(match.tags) ? match.tags : [];
    const interests = Array.isArray(match.interests) ? match.interests : [];
    entry.interests = [
      ...tags.map((t) => t.tag),
      ...interests.map((t) => t.interest),
    ]
      .filter((v) => typeof v === "string")
      .join(", ")
      .slice(0, 400);
    // A street or a postcode is only ever in an address, so the model sees
    // them to check a question about a place.
    const addresses = addressesOf(match);
    if (addresses.length) entry.addresses = addresses.join(" | ").slice(0, 400);
    const passages = selected.get(match.id);
    if (passages?.length) {
      entry.passages = passages.map(({ id, field, context, text }) => ({
        id,
        field,
        context,
        text,
      }));
      // Relevant passages replace the fixed prefix of these fields.
      if (passages.some((passage) => passage.field === "about"))
        delete entry.about;
      if (passages.some((passage) => passage.field === "preferences"))
        delete entry.preferences;
    }
    // Reserve room for every candidate. Drop duplicate context before evidence.
    const budget = Math.floor(
      (23_000 - size) /
        (Math.min(matches.length, RERANKER_LIMIT) - compressed.length),
    );
    while (
      JSON.stringify(entry).length > budget &&
      (entry.passages?.length ?? 0) > 1
    )
      entry.passages!.pop();
    for (const field of [
      "about",
      "preferences",
      "headline",
      "interests",
    ] as const) {
      if (JSON.stringify(entry).length <= budget) break;
      delete entry[field];
    }
    const bytes = JSON.stringify(entry).length + 1;
    if (size + bytes > 23_000) break;
    compressed.push(entry);
    size += bytes;
  }
  return compressed;
}

/**
 * The reranker's evidence as a reason part. The candidate's `interests`
 * holds tags and interests together, so the value is looked up in both. A
 * name match needs no reason: the card shows the name.
 */
function rerankEvidence(
  contact: HydratedMatch,
  match: SemanticMatchResult,
  scope: Scope,
): ReasonEvidence | null {
  const value = match.verified_value;
  const has = (list: unknown, key: string) =>
    Array.isArray(list) &&
    list.some(
      (item) =>
        typeof item?.[key] === "string" &&
        item[key].toLowerCase().includes(value.toLowerCase()),
    );
  switch (match.verified_field) {
    case "passage": {
      const passage = match.passage_id
        ? currentPassage(scope, contact.id, match.passage_id, value)
        : null;
      return passage ? { field: passage.field, value } : null;
    }
    case "name":
      return null;
    case "addresses": {
      // The whole address the quote is from, as the contact has it.
      const address = addressesOf(contact).find((text) =>
        text.toLowerCase().includes(value.toLowerCase()),
      );
      return address ? { field: "address", value: address } : null;
    }
    case "interests":
      return {
        field:
          has(contact.tags, "tag") && !has(contact.interests, "interest")
            ? "tag"
            : "interest",
        value,
      };
    case "role":
    case "headline":
    case "about":
    case "preferences":
      return { field: match.verified_field, value };
    default:
      return { field: match.verified_field };
  }
}

/** The ids in last-contact order: never contacted first, then the oldest. */
function byLastContact(allowed: AllowedContact[]): string[] {
  return [...allowed]
    .sort((a, b) => {
      if (a.lastContactedAt === b.lastContactedAt)
        return a.name.localeCompare(b.name);
      if (a.lastContactedAt === null) return -1;
      if (b.lastContactedAt === null) return 1;
      return a.lastContactedAt < b.lastContactedAt ? -1 : 1;
    })
    .map((contact) => contact.id);
}

/**
 * How the database alone proves a plan, or null when a model must check it.
 *
 * "filters": the planner is confident, and its hard filters hold every
 * constraint of the question (no soft traits). "temporal": the question
 * asks only about recency, which is a date comparison the reranker cannot
 * make, because candidates carry no dates.
 */
export function databaseProof(plan: QueryPlan): "filters" | "temporal" | null {
  if (plan.confidence === "low" || plan.should.traits?.length) return null;
  const { temporal, locations, locationMatchers, ...rest } = plan.must;
  const matchers =
    !!locations?.length ||
    !!locationMatchers?.length ||
    !!rest.companyMatchers?.length ||
    !!rest.roleMatchers?.length ||
    !!rest.industryMatchers?.length;
  if (temporal && !matchers) return "temporal";
  if (matchers && plan.confidence === "high") return "filters";
  return null;
}

/**
 * The owner's notes revision, which every note insert, edit and delete
 * bumps (`installSearchIndex` in ftsIndex.ts).
 *
 * A note moves its contact's last contact and the passages a search reads,
 * and neither moves the search revision. So an answer to "founders I have
 * not talked to in 3 months" kept a person for five minutes after a call
 * with them was logged.
 */
function notesRevision(scope: Scope): number {
  const row = sqlite
    .prepare("SELECT revision FROM notes_revision WHERE ownerId = ?")
    .get(scope.ownerId) as { revision: number } | undefined;
  return row?.revision ?? 0;
}

export function searchRevision(scope: Scope): number {
  const row = sqlite
    .prepare("SELECT revision FROM search_revision WHERE ownerId = ?")
    .get(scope.ownerId) as { revision: number } | undefined;
  return row?.revision ?? 0;
}

interface SearchResult {
  matches: HydratedMatch[];
  /** The model did not verify this list. */
  fallback: boolean;
  cached?: boolean;
  /** For a question of facets alone: every contact they hold. */
  total?: number;
  /** For a question of facets alone: the same list as a Network query. */
  facets?: string;
  /** For a question of facets alone, cut at 30: facets that split it. */
  refine?: RefineOption[];
}
interface SearchChunk extends SearchResult {
  phase: "instant" | "complete";
  latencyMs?: number;
}

/** Mark local results as not verified by anybody. */
const unverified = (matches: HydratedMatch[]): HydratedMatch[] =>
  matches.map((match) => ({ ...match, verified: false }));

/**
 * The final answer once the plan exists.
 *
 * When the database proves the plan, the filtered contacts are the answer
 * and the reranker does not run: in retrieval order, then the rest of the
 * filtered contacts by name, or by last contact for a recency question. Any
 * other plan goes to the reranker. Every reason is built here, from what the
 * plan's filter, the facets and the reranker proved.
 */
async function answerFromPlan(
  scope: Scope,
  query: string,
  retrieval: RetrievalResult,
  signal: AbortSignal,
  filters: FacetFilter[] = [],
  terms: QuestionTerms = questionTerms(query),
): Promise<{ result: SearchResult; path: string }> {
  const { plan, candidates, allowed } = retrieval;
  const planEvidence =
    retrieval.evidence ?? new Map<string, ReasonEvidence[]>();
  const evidenceOf = (contact: HydratedMatch) => [
    ...(planEvidence.get(contact.id) ?? []),
    ...facetEvidence(contact, filters),
  ];
  const proof = plan && allowed ? databaseProof(plan) : null;

  if (proof && allowed) {
    let ids: string[];
    if (proof === "temporal") ids = byLastContact(allowed);
    else {
      ids = candidates.map((c) => c.contactId);
      if (ids.length < PHASE1_LIMIT) {
        const ranked = new Set(ids);
        ids.push(
          ...allowed
            .filter((contact) => !ranked.has(contact.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((contact) => contact.id),
        );
      }
    }
    const hydrated = hydrateCandidates(scope, ids, PHASE1_LIMIT);
    return {
      path: proof === "temporal" ? "sql-temporal" : "sql",
      result: {
        matches: withMatchedOn(
          [...hydrated.values()].map((contact) => ({
            ...contact,
            verified: true,
            aiReason: buildReason(contact, evidenceOf(contact)),
          })),
          terms,
          (contact) => filterProofs(evidenceOf(contact)),
        ),
        fallback: false,
      },
    };
  }

  if (!candidates.length)
    return { path: "empty", result: { matches: [], fallback: false } };
  const pool = [
    ...hydrateCandidates(
      scope,
      candidates.map((c) => c.contactId),
      PHASE1_LIMIT,
    ).values(),
  ];
  const verified = await rerankCandidates(
    query,
    buildCompressedCandidates(pool, scope, query, retrieval.queryVector),
    plan,
    signal,
  );
  signal.throwIfAborted();
  const inPool = new Set(pool.map((c) => c.id));
  const fresh = hydrateCandidates(
    scope,
    verified
      .filter((match) => inPool.has(match.contact_id))
      .map((match) => match.contact_id),
    PHASE1_LIMIT,
  );
  return {
    path: "rerank",
    result: {
      matches: verified.flatMap((match) => {
        const contact = fresh.get(match.contact_id);
        if (!contact) return [];
        const passage = match.passage_id
          ? currentPassage(
              scope,
              contact.id,
              match.passage_id,
              match.verified_value,
            )
          : null;
        const cited = rerankEvidence(contact, match, scope);
        if (match.verified_field === "passage" && !cited) return [];
        const filtered = evidenceOf(contact).filter(
          (item) => item.field !== cited?.field,
        );
        const proofs: MatchProof[] = [
          ...(cited ? [{ evidence: cited, how: "ai" as const }] : []),
          ...filterProofs(filtered),
        ];
        return [
          {
            ...contact,
            verified: true,
            matchedOn: explainMatch(contact, terms, proofs),
            ...(passage
              ? {
                  aiEvidence: {
                    contactId: contact.id,
                    passageId: passage.id,
                    field: passage.field,
                    sourceId: passage.sourceId,
                    sourceHash: passage.sourceHash,
                    startOffset: passage.startOffset,
                    endOffset: passage.endOffset,
                    quote: match.verified_value,
                  },
                }
              : {}),
            aiReason: buildReason(
              contact,
              cited ? [cited, ...filtered] : filtered,
            ),
          },
        ];
      }),
      fallback: false,
    },
  };
}

/**
 * One pipeline supplies both streaming and JSON callers.
 *
 * 1. The L1 cache. Its key holds the facets.
 * 2. Facets: the request's, and any typed into the question. A question
 *    that is only facets is answered by the database, in name order.
 * 3. Strict keyword search, which also decides the query's kind.
 * 4. A name, an email, a phone number or a quoted phrase is answered here,
 *    verified, with no model call.
 * 5. Implicit facets: "people in Lisbon" or "who works at Northwind
 *    Logistics" is a filter, and needs no model when nothing else is asked.
 * 6. Otherwise the local hybrid list streams as the instant chunk.
 * 7. With AI off or no provider, that list is the answer.
 * 8. The planner, then the database proof or the reranker, in the search lane
 *    within one budget. The facets constrain every stage.
 * 9. On an error, a timeout or an edit mid-flight, a fresh local list is the
 *    answer. Local results are never thrown away.
 */
async function runSearch(
  scope: Scope,
  query: string,
  rid: string,
  emit?: (chunk: SearchChunk) => void,
  signal?: AbortSignal,
  options: SemanticSearchOptions = {},
): Promise<SearchResult> {
  signal?.throwIfAborted();
  const start = performance.now();
  const aiAllowed = options.aiAllowed !== false;
  const models = aiAllowed && !isMockMode();
  const revision = searchRevision(scope);
  const notes = notesRevision(scope);
  const capability = models ? resolveCapability("quick") : null;
  // Facets typed into the question count with the ones the request carries.
  const typed = parseFacetQuery(query);
  const filters = uniqueFacets([...(options.filters ?? []), ...typed.filters]);
  const text = typed.freeText.trim();
  // The question's words, read once for every result's matched fields.
  const terms = questionTerms(text);
  const normalizedQuery = normalizeKey(text);
  // With no model to run, the answer is local, and "local" keeps it apart
  // from every answer a model verified.
  const answeredBy = models
    ? `${capability?.providerId}:${capability?.model}`
    : "local";
  const facetPart = facetKey(filters);
  // The cross-encoder orders the local list once its model has loaded, so a
  // list cached before that must not answer after it.
  const rerank =
    options.crossEncoder === false
      ? null
      : {
          model: rerankModel(),
          count: RERANK_CANDIDATES,
          ...(typeof options.crossEncoder === "object"
            ? options.crossEncoder
            : {}),
        };
  const reorderBy =
    rerank?.model && isCrossEncoderReady(rerank.model)
      ? `${rerank.model}@${rerank.count}`
      : "fused";
  const cacheKey = `${revision}:${notes}:${Math.floor(Date.now() / 300_000)}:${answeredBy}:${options.rrfK ?? ""}:${reorderBy}:${facetPart}:${normalizedQuery}`;
  const cached = getCachedSearch(scope, cacheKey);
  if (cached)
    return {
      ...cached,
      matches: cached.matches as HydratedMatch[],
      cached: true,
    };
  const elapsed = () => Math.round(performance.now() - start);
  const done = (result: SearchResult, kind: string, path: string) => {
    log.info(
      "SemanticSearch",
      `[${rid}] "${query.slice(0, 60)}" kind=${kind} path=${path}` +
        `${filters.length ? ` facets=${filters.length}` : ""} ` +
        `→ ${result.matches.length} ${result.fallback ? "unverified" : "verified"} in ${elapsed()}ms`,
    );
    return result;
  };
  // Set once the question's vector exists, on the model path only.
  let semanticKey: SemanticKey | null = null;
  const final = (result: SearchResult, kind: string, path: string) => {
    // A facet answer is one database read, and it reads columns the revision
    // does not follow: tracking, the last contact, the date of an edit. Kept,
    // "Who haven't I contacted in over 3 months?" listed a person for five
    // minutes after a call with them was logged.
    if (path !== "facets") setCachedSearch(scope, cacheKey, result);
    // L2 keeps only answers someone verified, with the question's vector.
    if (semanticKey && !result.fallback)
      setSemanticAnswer(scope, semanticKey, result);
    return done(result, kind, path);
  };

  // A question made only of facets is a filter.
  let facets = filters.length ? compileFacets(scope, filters) : null;
  if (!text)
    return final(
      facets
        ? facetAnswer(scope, facets, filters, terms)
        : { matches: [], fallback: false },
      "facets",
      "facets",
    );

  // Local kinds: the keyword answer is final and verified. A name, an
  // email or a phone number needs no reason: the card shows it. A quoted
  // phrase says where it was found.
  const { intent, strict } = queryIntent(scope, text, facets, PHASE1_LIMIT);
  if (intent.local) {
    const matches = hydrateLexical(scope, strict, PHASE1_LIMIT).map(
      (match) => ({ ...match, verified: true }),
    );
    return final(
      {
        matches:
          intent.kind === "quoted" ? withMatchedOn(matches, terms) : matches,
        fallback: false,
      },
      intent.kind,
      "local",
    );
  }

  // Facets in the words: a company, a place or an industry the owner's
  // contacts hold. When they are all the question asks, no model runs.
  // Otherwise they join the request's facets for every stage below.
  const implicit = findImplicitFacets(scope, text);
  let allFilters = filters;
  if (implicit.filters.length) {
    allFilters = uniqueFacets([...filters, ...implicit.filters]);
    facets = compileFacets(scope, allFilters);
    if (!hasContentWords(implicit.remainder))
      return final(
        facetAnswer(scope, facets, allFilters, terms),
        intent.kind,
        "facets",
      );
  }

  // The local list: keyword and vector results fused, then, for a question,
  // the top of the list reordered by the cross-encoder inside its budget,
  // then cut to the list's length. A cross-encoder is not typo-tolerant, so
  // it reads questions only: never a name, an email or a phone number (they
  // do not reach here), and never a short `mixed` query, which is usually a
  // misspelled name or a prefix.
  const reorder =
    rerank && reorderBy !== "fused" && intent.kind === "conceptual"
      ? rerank
      : null;
  const listLength = reorder
    ? Math.max(PHASE1_LIMIT, reorder.count)
    : PHASE1_LIMIT;
  const localList = async (queryVector?: Float32Array | null) => {
    const listRevision = searchRevision(scope);
    const local = await localRetrieval(scope, text, {
      intent,
      limit: listLength,
      queryVector,
      aiAllowed,
      facets,
      rrfK: options.rrfK,
    });
    const fused = [
      ...hydrateCandidates(
        scope,
        local.candidates.map((c) => c.contactId),
        listLength,
      ).values(),
    ];
    const relevant: Map<string, SearchPassage[]> = reorder
      ? selectPassages(
          scope,
          text,
          fused.map((contact) => contact.id),
          local.queryVector
            ? findPassageNeighbors(
                scope,
                local.queryVector,
                new Set(fused.map((contact) => contact.id)),
              )
            : [],
        )
      : new Map();
    const ordered = reorder
      ? await rerankLocal(text, fused, rerankBudgetMs(), {
          ...reorder,
          documents: fused.map((contact) => {
            const passage = relevant.get(contact.id)?.[0];
            return passage
              ? `${passage.context} | ${passage.text} | ${profileText(contact)}`.slice(
                  0,
                  600,
                )
              : profileText(contact);
          }),
        })
      : fused;
    if (reorder && searchRevision(scope) !== listRevision) {
      // Scoring yields after hydration. An edit can remove a contact or
      // change its fields during that wait. Rebuild from current keywords,
      // without another asynchronous model stage before returning the rows.
      const fresh = await localRetrieval(scope, text, {
        intent,
        limit: PHASE1_LIMIT,
        queryVector: null,
        aiAllowed,
        facets,
        rrfK: options.rrfK,
      });
      return {
        local: fresh,
        matches: withMatchedOn(
          unverified([
            ...hydrateCandidates(
              scope,
              fresh.candidates.map((c) => c.contactId),
              PHASE1_LIMIT,
            ).values(),
          ]),
          terms,
        ),
      };
    }
    // The passages the cross-encoder read explain a match in meaning when
    // no field holds the question's words.
    return {
      local,
      matches: withMatchedOn(
        unverified(ordered.slice(0, PHASE1_LIMIT)),
        terms,
        () => [],
        (contact) => relevant.get(contact.id) ?? [],
      ),
    };
  };
  if (!models) {
    // No model can run, so this list is the answer, the same until the next
    // edit, under a key no model answer shares.
    const result = { matches: (await localList()).matches, fallback: true };
    signal?.throwIfAborted();
    return final(result, intent.kind, "no-ai");
  }

  // The question is embedded once. The local list and the model stage read
  // the same vector, and so does L2, the semantic cache.
  const queryVector = embedQuery(scope, text, aiAllowed, signal);

  // L2 answers a question asked in other words, with no model call. Its
  // 0.97 threshold was measured on the built-in model, so a provider's
  // embedding model leaves it off, and that vector is not waited for here.
  // The built-in model takes about a millisecond.
  if (resolveEmbeddings().kind === "builtin") {
    const vector = await queryVector;
    signal?.throwIfAborted();
    // Embedding yields to other requests. An edit during that wait makes
    // every answer under the starting revision stale, including an L2 hit.
    if (vector && searchRevision(scope) === revision) {
      semanticKey = {
        revision,
        notes,
        facets: facetKey(allFilters),
        answeredBy,
        entities: entityKey(text),
        constraints: constraintKey(text, implicit.remainder),
        vector,
      };
      const hit = getSemanticAnswer<SearchResult>(scope, semanticKey);
      if (hit) {
        // Into L1 for the exact words, but not into L2 again: a chain of
        // near questions could otherwise drift from the one that was
        // answered.
        setCachedSearch(scope, cacheKey, hit);
        return { ...done(hit, intent.kind, "semantic-cache"), cached: true };
      }
    }
  }

  // The model stage starts now, and the local list is built while the
  // planner's request is on the network. The list then costs the answer
  // nothing.
  const coalesceKey = `${scope.ownerId}:search:${revision}:${notes}:${capability?.providerId ?? "none"}:${capability?.model ?? "none"}:${facetPart}:${normalizedQuery}`;

  const answer = searchCoalescer.coalesce(
    coalesceKey,
    async (sharedSignal) => {
      // Double check cache in case a previous coalesced execution just populated it
      const freshCached = getCachedSearch(scope, cacheKey);
      if (freshCached) {
        return {
          ...freshCached,
          matches: freshCached.matches as HydratedMatch[],
          cached: true,
        };
      }
      const fallback = async (path: string) =>
        done(
          {
            matches: (await localList(await queryVector)).matches,
            fallback: true,
          },
          intent.kind,
          path,
        );

      let answered: { result: SearchResult; path: string };
      try {
        answered = await withTimeout(
          async (budget) => {
            const retrieval = await hybridRetrieval(scope, text, rid, budget, {
              vector: { text, vector: queryVector },
              aiAllowed,
              intent,
              facets,
              rrfK: options.rrfK,
            });
            budget.throwIfAborted();
            return answerFromPlan(
              scope,
              text,
              retrieval,
              budget,
              allFilters,
              terms,
            );
          },
          MODEL_BUDGET_MS,
          sharedSignal,
        );
      } catch (error) {
        sharedSignal?.throwIfAborted();
        log.warn(
          "SemanticSearch",
          `[${rid}] AI refinement unavailable: ${getErrorMessage(error)}`,
        );
        return fallback("fallback");
      }
      sharedSignal?.throwIfAborted();
      // A concurrent edit in this account invalidates evidence gathered before that edit.
      if (searchRevision(scope) !== revision) return fallback("edited");
      return final(answered.result, intent.kind, answered.path);
    },
    signal,
  );
  // Awaited below. This only keeps a rejection that lands first from being
  // reported as unhandled.
  answer.catch(() => {});

  const first = await localList(await queryVector);
  signal?.throwIfAborted();
  emit?.({
    phase: "instant",
    matches: first.matches,
    fallback: true,
    latencyMs: elapsed(),
  });
  return answer;
}

// =============================================================================
// FTS5 Keyword Search (sidebar quick-search, unchanged from v1)
// =============================================================================

export const searchService = {
  /**
   * FTS5 keyword search — used by the sidebar quick-search.
   * Simple, fast, exact-match search.
   */
  searchFts(scope: Scope, q: string, filters: FacetFilter[] = []) {
    // The facets run inside the keyword search, before its limit.
    const facets = filters.length ? compileFacets(scope, filters) : null;
    return hydrateLexical(
      scope,
      lexicalSearch(scope, q, 20, null, false, facets),
      20,
    );
  },

  /**
   * Stream local candidates, then one terminal result. Never write after
   * disconnect.
   *
   * The route reads the scope before it calls this and passes it in, because
   * `res` is the only request object that reaches here and an NDJSON writer
   * must not depend on the async context surviving the stream.
   */
  async semanticSearchStream(
    scope: Scope,
    query: string,
    rid: string,
    res: Response,
    signal?: AbortSignal,
    options?: SemanticSearchOptions,
  ) {
    const send = (chunk: SearchChunk) => {
      if (!signal?.aborted && !res.destroyed && !res.writableEnded)
        res.write(JSON.stringify(chunk) + "\n");
    };
    try {
      const result = await runSearch(scope, query, rid, send, signal, options);
      send({ phase: "complete", ...result });
    } catch (error) {
      if (!signal?.aborted && !res.destroyed && !res.writableEnded)
        res.write(
          JSON.stringify({
            phase: "error",
            error: "Search failed. Please try again.",
            requestId: rid,
          }) + "\n",
        );
      log.warn(
        "SemanticSearch",
        `[${rid}] Search stopped: ${getErrorMessage(error)}`,
      );
    } finally {
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  },

  /** Return the same final result as the streaming endpoint. */
  semanticSearch(
    scope: Scope,
    query: string,
    rid: string,
    signal?: AbortSignal,
    options?: SemanticSearchOptions,
  ) {
    return runSearch(scope, query, rid, undefined, signal, options);
  },
};
