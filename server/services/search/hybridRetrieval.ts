import { findPassages } from "./passages.ts";
import { matchesQueryLocations } from "../../ai/searchLocations.ts";
// Hybrid retrieval applies a bounded AI query plan, then combines local
// keyword and vector rankings. `localRetrieval` is the part with no plan:
// SearchService sends its list before the plan exists, and falls back to it
// when the model fails. Every semantic result still requires verified field
// evidence, from the plan's hard filter or from the reranker.

import { sqlite } from "../../db.ts";
import { lexicalSearch, type LexicalMatch } from "./lexical.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { log } from "../../utils/logger.ts";
import {
  isSearchEmbeddingReady,
  embedText,
  findSearchNeighbors,
  findPassageNeighbors,
  getSearchEmbeddingCount,
} from "./vectorIndex.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { parseSearchQuery } from "../../ai/aiService.ts";
import { roleVariants } from "../../ai/queryConstraints.ts";
import { currentEmbedder } from "../../ai/embedder.ts";
import { withTimeout } from "../../ai/resilience.ts";
import type { QueryPlan } from "../../ai/types.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { classifyQuery, nameSignals, type QueryIntent } from "./intent.ts";
import type { ReasonEvidence } from "./reasons.ts";
import type { CompiledFacets } from "./facetSql.ts";

// =============================================================================
// Types
// =============================================================================

/** The ranked lists reciprocal rank fusion combines. */
export type FusionChannel = "lexical" | "dense" | "trait" | "passage";

export interface RetrievalCandidate {
  contactId: string;
  /** Fused RRF score (higher = more relevant) */
  score: number;
  /** Which channels contributed to this candidate */
  channels: FusionChannel[];
}

export interface RetrievalResult {
  candidates: RetrievalCandidate[];
  /** Semantic candidates require downstream evidence verification. */
  highConfidence: boolean;
  /** Pre-filter summary for logs and debug UI. */
  preFilterSummary: string;
  /**
   * The LLM-extracted QueryPlan, or null when AI was unavailable / parse
   * failed. Downstream stages (rerank, synthesis) consume this to verify
   * candidates against the user's structured intent.
   */
  plan: QueryPlan | null;
  queryVector?: Float32Array | null;
  /**
   * The contacts the plan's hard filter allowed, name and last contact
   * included, or null when no filter applied. When the filter holds every
   * constraint, these are the answer.
   */
  allowed?: AllowedContact[] | null;
  /** For each allowed contact, the fields the filter proved. */
  evidence?: Map<string, ReasonEvidence[]>;
}

/** A contact that passed the hard filter. */
export interface AllowedContact {
  id: string;
  name: string;
  lastContactedAt: string | null;
}

/** One contact in a ranked list. Ranks start at 1. */
export interface RankedItem {
  contactId: string;
  rank: number;
}

/** One ranked list for the fusion, with its channel and its weight. */
export interface FusionList {
  channel: FusionChannel;
  weight: number;
  items: RankedItem[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * RRF smoothing constant.
 * k=15 provides sharper discrimination than k=60 for ~960 rows:
 *   top-1 = 1/16 = 0.0625 vs top-10 = 1/25 = 0.04 (~36% drop)
 *   (k=60: top-1 = 0.0164 vs top-10 = 0.0143 — too flat)
 *
 * Measured with the weighted lists on the 70 golden queries
 * (`node scripts/benchmark-search.ts --contacts N --rrf-k K`). Recall@10 was
 * 1.00 at every k. The fused MRR was 0.950, 0.942 and 0.942 at 300 contacts
 * and 0.917, 0.915 and 0.906 at 5,000 for k = 15, 30 and 60, so 15 stays.
 */
export const RRF_K = 15;

/** The weight all trait lists share. Each of n lists has 0.3 / n. */
const TRAIT_WEIGHT = 0.3;

/** Max results for FTS5 (generous — let BM25 scoring do the work) */
const FTS_LIMIT = 100;

/** Max vector neighbors */
const VECTOR_LIMIT = 100;

/** Limit per soft boost channel — keeps RRF math bounded. */
const BOOST_LIMIT = 50;

/** Trait matches read before they are ranked and cut to BOOST_LIMIT. */
const TRAIT_SCAN_LIMIT = 500;

// =============================================================================
// Phase 0: Hard Pre-Filter (QueryPlan.must → Set<contactId>)
// =============================================================================
// This is the core v5 change. When the planner produces a high-confidence
// `must.*Matchers` list, we apply it as a HARD constraint against the
// relevant contact column. Only contacts that pass become candidates for
// FTS/vector retrieval.
//
// Matching is JS-side word-boundary regex (case-insensitive) so we can
// safely include 2-letter codes ("CA", "NY") without false-matching
// "Casablanca" or "Anywhere".

interface HardFilterResult {
  /** Set of contact IDs allowed downstream, or null = "no filter". */
  allowedIds: Set<string> | null;
  /** The allowed contacts in database order, or null = "no filter". */
  allowed: AllowedContact[] | null;
  /** For each allowed contact, the fields the filter proved, in reason order. */
  evidence: Map<string, ReasonEvidence[]>;
  /** Per-dimension active matcher counts, for logging. */
  summary: string;
}

/** The text a regex matched, without the boundary character it consumed. */
function matchedText(re: RegExp, haystack: string): string | undefined {
  return re
    .exec(haystack)?.[0]
    .replace(/^[^\p{L}\p{N}]/u, "")
    .trim();
}

/**
 * Active contacts only — ghosts, archived contacts, and soft-merged
 * (canonical replaced) contacts are excluded from all search results.
 */
const ACTIVE_GATE_SQL = ACTIVE_CONTACT_SQL;

/**
 * Compile a list of matchers into a single case-insensitive word-boundary
 * regex. Word boundary uses `(?:^|[^\\p{L}\\p{N}])` and `(?=[^\\p{L}\\p{N}]|$)`
 * (not \b) so that hyphenated/punctuated text matches correctly without
 * Unicode surprises.
 */
function buildMatcherRegex(matchers: string[]): RegExp | null {
  if (!matchers.length) return null;
  const parts = matchers
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.length) return null;
  // Sort longest-first so the alternation prefers the most specific match
  parts.sort((a, b) => b.length - a.length);
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${parts.join("|")})(?=[^\\p{L}\\p{N}]|$)`,
    "iu",
  );
}

/**
 * Apply the QueryPlan's `must` filters as a hard pre-filter against the
 * active contact corpus. Returns the set of allowed contact IDs, or null
 * if no filters apply.
 */
function applyHardFilters(
  scope: Scope,
  plan: QueryPlan,
  facets?: CompiledFacets | null,
): HardFilterResult {
  // Low-confidence parses skip hard filters entirely — exploratory queries
  // shouldn't get gated on a possibly-wrong extraction.
  if (plan.confidence === "low") {
    return {
      allowedIds: null,
      allowed: null,
      evidence: new Map(),
      summary: "low-confidence (no hard filter)",
    };
  }

  const locRe = buildMatcherRegex(plan.must.locationMatchers ?? []);
  const coRe = buildMatcherRegex(plan.must.companyMatchers ?? []);
  // A role also matches its other forms: "engineer" finds Engineering.
  const roleRe = buildMatcherRegex(
    (plan.must.roleMatchers ?? []).flatMap(roleVariants),
  );
  const indRe = buildMatcherRegex(plan.must.industryMatchers ?? []);
  const temporal = plan.must.temporal;

  if (
    !plan.must.locations?.length &&
    !locRe &&
    !coRe &&
    !roleRe &&
    !indRe &&
    !temporal
  ) {
    return {
      allowedIds: null,
      allowed: null,
      evidence: new Map(),
      summary: "no hard filters",
    };
  }

  // Build the temporal predicate as SQL — it's cheaper than streaming
  // dates through JS and we already have the index.
  let temporalSql = "";
  const temporalParams: string[] = [];
  if (temporal) {
    if (temporal.type === "neverContacted") {
      temporalSql = ` AND lastContactedAt IS NULL`;
    } else {
      const days = temporal.daysAgo ?? 90;
      temporalSql = ` AND (lastContactedAt IS NULL OR lastContactedAt < datetime('now', ?))`;
      temporalParams.push(`-${days} days`);
    }
  }

  // Fetch only the columns we need to evaluate the matchers; for industry,
  // we also fetch tags + interests inline as a coalesced text blob. Only for
  // industry: the two subqueries cost a lookup per contact.
  const childText = indRe
    ? `COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') AS tagsText,
        COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') AS interestsText`
    : `'' AS tagsText, '' AS interestsText`;
  // A place can be in an address: a street or a postcode only ever is. The
  // subquery reads the (contactId, address) index, and only for a place.
  const hasLocation = !!plan.must.locations?.length || !!locRe;
  const addressText = hasLocation
    ? "(SELECT json_group_array(address) FROM contact_addresses WHERE contactId = c.id) AS addressesJson"
    : "'[]' AS addressesJson";
  // The request's facets narrow the filter too, so its contacts hold both.
  const facetClause = facets ? ` AND (${facets.sql})` : "";
  const rows = sqlite
    .prepare(
      `
      SELECT
        c.id,
        c.name,
        c.lastContactedAt,
        c.location,
        c.company,
        c.role,
        c.headline,
        c.industry,
        ${childText},
        ${addressText}
      FROM contacts c
      WHERE c.ownerId = ? AND ${ACTIVE_GATE_SQL}${temporalSql}${facetClause}
    `,
    )
    .all(scope.ownerId, ...temporalParams, ...(facets?.params ?? [])) as {
    id: string;
    name: string;
    lastContactedAt: string | null;
    location: string | null;
    company: string | null;
    role: string | null;
    headline: string | null;
    industry: string | null;
    tagsText: string;
    interestsText: string;
    addressesJson: string;
  }[];

  const allowedIds = new Set<string>();
  const allowed: AllowedContact[] = [];
  const evidence = new Map<string, ReasonEvidence[]>();
  const inPlace = (text: string) =>
    plan.must.locations?.length
      ? matchesQueryLocations(text, plan.must.locations)
      : !!locRe && locRe.test(text);
  for (const r of rows) {
    // The location first, then each address, and the proof names the one.
    let placeProof: ReasonEvidence | undefined;
    if (hasLocation) {
      if (r.location && inPlace(r.location)) placeProof = { field: "location" };
      else {
        const address = (JSON.parse(r.addressesJson) as string[]).find(inPlace);
        if (!address) continue;
        placeProof = { field: "address", value: address };
      }
    }
    if (coRe && !(r.company && coRe.test(r.company))) continue;
    // The current role takes precedence over a headline about prior work.
    const currentRole = r.role?.trim() || r.headline;
    if (roleRe) {
      if (!currentRole || !roleRe.test(currentRole)) continue;
    }
    let industryProof: ReasonEvidence | undefined;
    if (indRe) {
      const inIndustry = r.industry && indRe.test(r.industry);
      const inTags = r.tagsText && indRe.test(r.tagsText);
      const inInterests = r.interestsText && indRe.test(r.interestsText);
      if (!inIndustry && !inTags && !inInterests) continue;
      industryProof = inIndustry
        ? { field: "industry" }
        : inTags
          ? { field: "tag", value: matchedText(indRe, r.tagsText) }
          : { field: "interest", value: matchedText(indRe, r.interestsText) };
    }
    allowedIds.add(r.id);
    allowed.push({
      id: r.id,
      name: r.name,
      lastContactedAt: r.lastContactedAt,
    });
    // What the filter proved, in the order a reason reads it.
    const proven: ReasonEvidence[] = [];
    if (roleRe && currentRole)
      proven.push({ field: "role", value: currentRole });
    if (coRe) proven.push({ field: "company" });
    if (placeProof) proven.push(placeProof);
    if (industryProof) proven.push(industryProof);
    if (temporal) proven.push({ field: "lastContact" });
    evidence.set(r.id, proven);
  }

  const summaryParts: string[] = [];
  if (locRe)
    summaryParts.push(`loc(${plan.must.locationMatchers?.length ?? 0})`);
  if (coRe) summaryParts.push(`co(${plan.must.companyMatchers?.length ?? 0})`);
  if (roleRe) summaryParts.push(`role(${plan.must.roleMatchers?.length ?? 0})`);
  if (indRe)
    summaryParts.push(`ind(${plan.must.industryMatchers?.length ?? 0})`);
  if (temporal) summaryParts.push(`temporal(${temporal.type})`);

  return {
    allowedIds,
    allowed,
    evidence,
    summary: `${summaryParts.join("+")}=${allowedIds.size}`,
  };
}

// =============================================================================
// Phase 1a: FTS5 Keyword Retrieval (Weighted BM25)
// =============================================================================

function ftsRetrieval(
  scope: Scope,
  query: string,
  preFilterIds: Set<string> | null,
  facets?: CompiledFacets | null,
): RankedItem[] {
  return lexicalSearch(scope, query, FTS_LIMIT, preFilterIds, true, facets).map(
    (row, i) => ({ contactId: row.contactId, rank: i + 1 }),
  );
}

// =============================================================================
// Phase 1b: Local Vector KNN Retrieval
// =============================================================================

/**
 * The vector of a question, or null when nothing here can embed it.
 *
 * The vector channel's own gates: an embedding backend is ready, the owner
 * has vectors to search, and with AI off only a local model may embed.
 * Ask computes it once, and the semantic cache, the local list and the model
 * stage all read the same vector. A failure is logged and counts as none.
 */
export async function embedQuery(
  scope: Scope,
  text: string,
  aiAllowed = true,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  if (!isSearchEmbeddingReady() || getSearchEmbeddingCount(scope) === 0)
    return null;
  // One embedder for the check and the call.
  const embedder = currentEmbedder();
  if (!aiAllowed && !embedder.local) return null;
  try {
    // A backfill can hold the worker queue. A query must not wait behind
    // it before the planner's own budget even starts. Cancel queued local
    // work after 100 ms and keep the keyword channel available. A local
    // model always runs on that worker: the main thread never loads
    // onnxruntime (`cpuWorker.ts`).
    return embedder.local
      ? await withTimeout(
          (budget) => embedText(text, budget, embedder),
          100,
          signal,
        )
      : await embedText(text, signal, embedder);
  } catch (err: unknown) {
    signal?.throwIfAborted();
    log.warn(
      "HybridRetrieval",
      `Query embedding failed: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

async function vectorRetrieval(
  scope: Scope,
  embedInputText: string,
  preFilterIds: Set<string> | null,
  queryVector?: Float32Array | null,
  aiAllowed = true,
  facets?: CompiledFacets | null,
): Promise<{ items: RankedItem[]; vector: Float32Array | null }> {
  // The count is per owner now. An account with no vectors of its own skips
  // the channel instead of asking a partition that holds nothing.
  if (!isSearchEmbeddingReady() || getSearchEmbeddingCount(scope) === 0) {
    return { items: [], vector: null };
  }
  // A provider's embedding model is a model call. With AI off for the
  // account only a local model may embed the query.
  if (!aiAllowed && !queryVector && !currentEmbedder().local)
    return { items: [], vector: null };

  try {
    // null means the shared attempt failed. Only undefined asks this
    // stage to embed, so an outage does not trigger a second model call.
    const vector =
      queryVector === undefined
        ? await embedQuery(scope, embedInputText, aiAllowed)
        : queryVector;
    if (!vector) return { items: [], vector: null };

    const contactNeighbors = findSearchNeighbors(
      scope,
      vector,
      VECTOR_LIMIT,
      preFilterIds ?? undefined,
      facets,
    );

    const neighbors = [
      ...contactNeighbors,
      ...findPassageNeighbors(scope, vector, preFilterIds, facets),
    ]
      .sort((a, b) => a.distance - b.distance)
      .filter(
        (item, index, rows) =>
          rows.findIndex((row) => row.contactId === item.contactId) === index,
      )
      .slice(0, VECTOR_LIMIT);
    return {
      items: neighbors.map((n, i) => ({ contactId: n.contactId, rank: i + 1 })),
      vector,
    };
  } catch (err: unknown) {
    log.warn(
      "HybridRetrieval",
      `Vector channel failed: ${getErrorMessage(err)}`,
    );
    return { items: [], vector: null };
  }
}

// =============================================================================
// Phase 1c: Soft Boost Channels (should.traits)
// =============================================================================
// Traits are a SOFT signal — a contact matching multiple traits ranks
// higher but is not gated on them. Each trait becomes its own ranked list
// in the RRF fusion, labelled `trait`, and the lists share one weight.
// Always intersected with the hard pre-filter set (if any) and the facets,
// so boosts can't surface excluded contacts.

function buildTraitBoosts(
  scope: Scope,
  plan: QueryPlan,
  allowedIds: Set<string> | null,
  facets: CompiledFacets | null | undefined,
  fused: RetrievalCandidate[],
): FusionList[] {
  const traits = plan.should.traits ?? [];
  if (traits.length === 0) return [];

  // Every contact in a list matches the trait, so the list is ranked by the
  // fused keyword and vector order: the best of the query's matches get the
  // biggest boost. Matches neither channel ranked follow, in table order.
  const fusedRank = new Map(fused.map((c, i) => [c.contactId, i]));
  const lists: RankedItem[][] = [];

  for (const trait of traits) {
    try {
      const rows = sqlite
        .prepare(
          `
          SELECT DISTINCT c.id
          FROM contacts c
          LEFT JOIN contact_tags t      ON t.contactId = c.id
          LEFT JOIN contact_interests i ON i.contactId = c.id
          WHERE c.ownerId = ?
            AND c.isGhost = 0
            AND (c.isArchived = 0 OR c.isArchived IS NULL)
            AND c.canonicalId IS NULL AND c.deletedAt IS NULL
            AND (${allowedIds ? "c.id IN (SELECT value FROM json_each(?))" : "1"})
            AND (${facets ? facets.sql : "1"})
            AND (
              c.about LIKE ? ESCAPE '\\' OR c.preferences LIKE ? ESCAPE '\\' OR c.headline LIKE ? ESCAPE '\\'
              OR c.searchExpansion LIKE ? ESCAPE '\\'
              OR t.tag LIKE ? ESCAPE '\\' OR i.interest LIKE ? ESCAPE '\\'
            )
          LIMIT ?
        `,
        )
        .all(
          scope.ownerId,
          ...(allowedIds ? [JSON.stringify([...allowedIds])] : []),
          ...(facets?.params ?? []),
          `%${trait.replace(/[\\%_]/g, "\\$&")}%`,
          `%${trait.replace(/[\\%_]/g, "\\$&")}%`,
          `%${trait.replace(/[\\%_]/g, "\\$&")}%`,
          `%${trait.replace(/[\\%_]/g, "\\$&")}%`,
          `%${trait.replace(/[\\%_]/g, "\\$&")}%`,
          `%${trait.replace(/[\\%_]/g, "\\$&")}%`,
          TRAIT_SCAN_LIMIT,
        ) as { id: string }[];

      const ids = rows
        .map((r) => r.id)
        .filter((id) => !allowedIds || allowedIds.has(id))
        .map((id, order) => ({ id, order }))
        .sort(
          (a, b) =>
            (fusedRank.get(a.id) ?? Infinity) -
              (fusedRank.get(b.id) ?? Infinity) || a.order - b.order,
        )
        .slice(0, BOOST_LIMIT);

      if (ids.length > 0)
        lists.push(ids.map(({ id }, i) => ({ contactId: id, rank: i + 1 })));
    } catch (err: unknown) {
      log.warn(
        "HybridRetrieval",
        `Trait boost failed for "${trait}": ${getErrorMessage(err)}`,
      );
    }
  }

  return lists.map((items) => ({
    channel: "trait" as const,
    weight: TRAIT_WEIGHT / lists.length,
    items,
  }));
}

// =============================================================================
// Reciprocal Rank Fusion (RRF)
// =============================================================================

/**
 * Weighted reciprocal rank fusion.
 *
 * `score(d)` is the sum over the lists that rank d of `weight / (k + rank)`,
 * with 1-based ranks. The weights come from the query's kind: a name leans
 * on the keyword list, a question on the vector list. A tie keeps the order
 * in which the lists first reached the contact, so the result is the same
 * on every run.
 */
export function reciprocalRankFusion(
  lists: FusionList[],
  k: number = RRF_K,
): RetrievalCandidate[] {
  const scoreMap = new Map<
    string,
    { score: number; channels: Set<FusionChannel> }
  >();

  for (const list of lists) {
    for (const item of list.items) {
      const entry = scoreMap.get(item.contactId) ?? {
        score: 0,
        channels: new Set<FusionChannel>(),
      };
      entry.score += list.weight / (k + item.rank);
      entry.channels.add(list.channel);
      scoreMap.set(item.contactId, entry);
    }
  }

  const candidates: RetrievalCandidate[] = [];
  for (const [contactId, { score, channels }] of scoreMap) {
    candidates.push({
      contactId,
      score,
      channels: Array.from(channels),
    });
  }

  // Array.prototype.sort is stable, so equal scores keep insertion order.
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// =============================================================================
// The query's kind, from its strict keyword matches
// =============================================================================

/**
 * Classify a query from its strict keyword matches.
 *
 * `classifyQuery` needs local name evidence: the names of the contacts the
 * query matches exactly or approximately. Returns the strict matches too,
 * because they are the whole answer for a name, an email or a phone.
 */
export function queryIntent(
  scope: Scope,
  query: string,
  facets?: CompiledFacets | null,
  limit = 30,
): { intent: QueryIntent; strict: LexicalMatch[] } {
  const strict = lexicalSearch(scope, query, limit, null, false, facets);
  if (!strict.length) return { intent: classifyQuery(query), strict };
  const rows = sqlite
    .prepare(
      "SELECT id, name FROM contacts WHERE ownerId = ? AND id IN (SELECT value FROM json_each(?))",
    )
    .all(scope.ownerId, JSON.stringify(strict.map((m) => m.contactId))) as {
    id: string;
    name: string;
  }[];
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const results = strict.flatMap((m) => {
    const name = names.get(m.contactId);
    return name ? [{ name, approximate: m.approximate, score: m.score }] : [];
  });
  return {
    intent: classifyQuery(query, nameSignals(query, results)),
    strict,
  };
}

// =============================================================================
// Local retrieval: keyword and vector channels, fused, with no plan
// =============================================================================

export interface LocalRetrievalOptions {
  /** Contacts a plan's hard filter allows, or null for no filter. */
  allowedIds?: Set<string> | null;
  /** The query's kind, which weights the channels. Read from the query when unset. */
  intent?: QueryIntent;
  /** How many fused candidates to return. All of them when unset. */
  limit?: number;
  /** The text the vector channel embeds. The query when unset. */
  embedInput?: string;
  /** A vector already computed for `embedInput`, so it is not embedded twice. */
  queryVector?: Float32Array | null;
  /** False when AI is off for the account: a provider may not embed the query. */
  aiAllowed?: boolean;
  /** Facets every channel applies before its limit. */
  facets?: CompiledFacets | null;
  /** The fusion constant. `RRF_K` when unset. The benchmark's k sweep sets it. */
  rrfK?: number;
}

export interface LocalRetrievalResult {
  /** The keyword and vector lists fused by weighted reciprocal rank. */
  candidates: RetrievalCandidate[];
  /** The keyword channel: FTS in broad mode, in four tiers. */
  lexical: RankedItem[];
  passage: RankedItem[];
  /** The vector channel. Empty when no embedding model is ready. */
  dense: RankedItem[];
  /** The vector the dense channel used, for reuse by a later stage. */
  queryVector: Float32Array | null;
  /** The kind whose weights the fusion used. */
  intent: QueryIntent;
  /** Wall time in milliseconds. */
  ms: number;
}

/** The keyword and vector lists with the weights of the query's kind. */
function channelLists(
  intent: QueryIntent,
  lexical: RankedItem[],
  dense: RankedItem[],
): FusionList[] {
  return [
    { channel: "lexical", weight: intent.weights.lexical, items: lexical },
    { channel: "dense", weight: intent.weights.dense, items: dense },
  ];
}

/**
 * Keyword and vector retrieval fused by weighted reciprocal rank, with no
 * model call.
 *
 * About 10 ms at 5,000 contacts. Ask Contrack shows this list before the
 * planner answers, and keeps it when the model fails. `hybridRetrieval`
 * runs the same arithmetic inside the plan's hard filter.
 */
export async function localRetrieval(
  scope: Scope,
  query: string,
  options: LocalRetrievalOptions = {},
): Promise<LocalRetrievalResult> {
  const t0 = performance.now();
  const allowedIds = options.allowedIds ?? null;
  const intent =
    options.intent ?? queryIntent(scope, query, options.facets).intent;
  const lexical = ftsRetrieval(scope, query, allowedIds, options.facets);
  const dense = await vectorRetrieval(
    scope,
    options.embedInput ?? query,
    allowedIds,
    options.queryVector,
    options.aiAllowed,
    options.facets,
  );
  const channels = channelLists(intent, lexical, dense.items);
  let passage: RankedItem[] = [];
  if (intent.kind === "conceptual") {
    const ids = [
      ...new Set(
        findPassages(scope, query, allowedIds, options.facets).map(
          (row) => row.contactId,
        ),
      ),
    ];
    passage = ids.map((contactId, index) => ({ contactId, rank: index + 1 }));
    if (ids.length)
      channels.push({
        channel: "passage",
        weight: intent.weights.lexical,
        items: passage,
      });
  }
  // TODO(v2.1): Expand the candidate budget only when held-out recall improves enough to justify added verification latency.
  const candidates = reciprocalRankFusion(channels, options.rrfK);
  return {
    candidates: options.limit ? candidates.slice(0, options.limit) : candidates,
    lexical,
    passage,
    dense: dense.items,
    queryVector: dense.vector,
    intent,
    ms: performance.now() - t0,
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

export interface HybridRetrievalOptions {
  /**
   * A query vector already computed, or being computed, and the text it
   * embeds. The planner runs first, so a vector still on its way is ready by
   * the time it is read.
   */
  vector?: {
    text: string;
    vector: Float32Array | null | Promise<Float32Array | null>;
  };
  /** False when AI is off for the account: a provider may not embed the query. */
  aiAllowed?: boolean;
  /** The query's kind, when the caller has it. Read from the query when unset. */
  intent?: QueryIntent;
  /** The request's facets, applied by every stage before its limit. */
  facets?: CompiledFacets | null;
  /** The fusion constant. `RRF_K` when unset. */
  rrfK?: number;
}

/** Apply hard filters before keyword/vector limits, then fuse ranked candidates. */
export async function hybridRetrieval(
  scope: Scope,
  query: string,
  rid: string,
  signal?: AbortSignal,
  options: HybridRetrievalOptions = {},
): Promise<RetrievalResult> {
  const t0 = Date.now();

  signal?.throwIfAborted();
  const plan = await parseSearchQuery(query, signal);
  signal?.throwIfAborted();
  const planned = Date.now();
  const facets = options.facets ?? null;

  // ── Phase 0: hard pre-filter ──────────────────────────────────────────
  let allowedIds: Set<string> | null = null;
  let allowed: AllowedContact[] | null = null;
  let evidence = new Map<string, ReasonEvidence[]>();
  let hardFilterSummary = "skipped (no plan)";
  if (plan) {
    const hf = applyHardFilters(scope, plan, facets);
    allowedIds = hf.allowedIds;
    allowed = hf.allowed;
    evidence = hf.evidence;
    hardFilterSummary = hf.summary;

    if (allowedIds !== null && allowedIds.size === 0) {
      // No contact passes the hard filter — return honestly empty.
      const elapsed = Date.now() - t0;
      log.info(
        "HybridRetrieval",
        `[${rid}] "${query.slice(0, 60)}" → 0 candidates ` +
          `(hard filter excluded all: ${hardFilterSummary}, conf=${plan.confidence}) ` +
          `in ${elapsed}ms`,
      );
      return {
        candidates: [],
        highConfidence: false,
        preFilterSummary: `no-match: ${hardFilterSummary}`,
        plan,
        allowed,
        evidence,
      };
    }
  }

  const embedInput = buildSearchEmbeddingInput(query, plan);
  const filtered = Date.now();

  // ── Phase 1: parallel retrieval (within filtered corpus) ──────────────
  const local = await localRetrieval(scope, query, {
    allowedIds,
    intent: options.intent,
    embedInput,
    queryVector:
      options.vector?.text === embedInput
        ? await options.vector.vector
        : undefined,
    aiAllowed: options.aiAllowed,
    facets,
    rrfK: options.rrfK,
  });

  // ── Phase 1c: soft boost channels (traits) ─────────────────────────────
  signal?.throwIfAborted();
  const traitBoosts = plan
    ? buildTraitBoosts(scope, plan, allowedIds, facets, local.candidates)
    : [];

  // ── Phase 2: weighted RRF across keyword, vector and trait lists ──────
  const fused = traitBoosts.length
    ? reciprocalRankFusion(
        [
          ...channelLists(local.intent, local.lexical, local.dense),
          ...(local.passage.length
            ? [
                {
                  channel: "passage" as const,
                  weight: local.intent.weights.lexical,
                  items: local.passage,
                },
              ]
            : []),
          ...traitBoosts,
        ],
        options.rrfK,
      )
    : local.candidates;

  // ── Phase 3: confidence assessment ─────────────────────────────────────
  // A high FTS ratio does not prove a natural-language constraint.
  // The service uses a separate local name-prefix shortcut.
  const highConfidence = false;

  const elapsed = Date.now() - t0;
  log.info(
    "HybridRetrieval",
    `[${rid}] "${query.slice(0, 60)}" → ` +
      `FTS:${local.lexical.length} + Vec:${local.dense.length}` +
      ` + Traits:${traitBoosts.length}ch ` +
      `→ ${fused.length} fused in ${elapsed}ms ` +
      `[planner ${planned - t0}ms, filter ${filtered - planned}ms, retrieval ${Date.now() - filtered}ms] ` +
      `(kind=${local.intent.kind}, plan: ${plan ? `conf=${plan.confidence}` : "none"}, ` +
      `filter: ${hardFilterSummary}, ` +
      `confidence: ${highConfidence ? "HIGH" : "low"})`,
  );

  return {
    candidates: fused,
    highConfidence,
    preFilterSummary: hardFilterSummary,
    plan,
    queryVector: local.queryVector,
    allowed,
    evidence,
  };
}

/** Use the same query expansion for retrieval and recorded evaluation vectors. */
export function buildSearchEmbeddingInput(
  query: string,
  plan?: QueryPlan | null,
): string {
  return [query, ...(plan?.should.traits ?? [])].join(". ");
}
