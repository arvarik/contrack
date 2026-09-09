import { matchesFacet, type FacetFilter } from "../../shared/searchFacets.ts";
import { sqlite } from "../db.ts";
import { lexicalSearch } from "./search/lexical.ts";
import { ACTIVE_CONTACT_SQL } from "./search/ftsIndex.ts";
import { log } from "../utils/logger.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { rerankCandidates, type CompressedContact } from "../ai/aiService.ts";
import { getCachedSearch, setCachedSearch } from "../utils/aiCache.ts";
import { hybridRetrieval } from "./search/hybridRetrieval.ts";
import type { Response } from "express";
import { getErrorMessage } from "../utils/helpers.ts";
import { resolveCapability } from "../ai/capabilities.ts";
import { withTimeout } from "../ai/resilience.ts";

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

// =============================================================================
// Types
// =============================================================================

/**
 * A fully hydrated contact row with an optional AI-generated reason.
 *
 * Uses `Record<string, unknown>` rather than `[key: string]: any` to
 * prevent silent `any`-propagation through the type system. The dynamic
 * shape comes from `contactRepo.hydrate()` which returns a plain object.
 */
export type HydratedMatch = Record<string, unknown> & {
  id: string;
  name: string;
  aiReason?: string | null;
};

// =============================================================================
// Shared Helpers (DRY — used by both streaming and non-streaming paths)
// =============================================================================

/**
 * Hydrate a list of contact IDs into full contact objects with `aiReason: null`.
 * Returns a Map keyed by contactId for O(1) lookup.
 */
function hydrateCandidates(
  candidateIds: string[],
  limit: number,
): Map<string, HydratedMatch> {
  const hydratedMap = new Map<string, HydratedMatch>();
  const topIds = candidateIds.slice(0, limit);
  if (!topIds.length) return hydratedMap;

  // Single IN(...) query + bulk hydration — this is the search hot path, and
  // per-id hydrate() here previously cost ~13 queries per candidate.
  const placeholders = topIds.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT c.* FROM contacts c WHERE c.id IN (${placeholders}) AND ${ACTIVE_CONTACT_SQL}`,
    )
    .all(topIds);
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

/**
 * Build compressed contact profiles for the LLM reranker.
 * Strips heavy fields (avatar, timestamps, child arrays) to minimize token usage.
 */
function buildCompressedCandidates(
  matches: HydratedMatch[],
): CompressedContact[] {
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
    const bytes = JSON.stringify(entry).length + 1;
    if (size + bytes > 23_000) break;
    compressed.push(entry);
    size += bytes;
  }
  return compressed;
}

function searchRevision(): number {
  return (
    sqlite.prepare("SELECT revision FROM search_revision WHERE id=1").get() as {
      revision: number;
    }
  ).revision;
}

interface SearchResult {
  matches: HydratedMatch[];
  fallback: boolean;
  cached?: boolean;
}
interface SearchChunk extends SearchResult {
  phase: "instant" | "complete";
  latencyMs?: number;
}

/** A short name prefix can use the local index without an AI generation. */
function isNameLookup(query: string, matches: HydratedMatch[]): boolean {
  const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return (
    matches.length > 0 &&
    tokens.length > 0 &&
    tokens.length <= 3 &&
    matches.every((match) => {
      const names =
        match.name.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      return tokens.every((token) =>
        names.some((name) => name.startsWith(token)),
      );
    })
  );
}

/** One pipeline supplies both streaming and JSON callers. */
async function runSearch(
  query: string,
  rid: string,
  emit?: (chunk: SearchChunk) => void,
  signal?: AbortSignal,
): Promise<SearchResult> {
  signal?.throwIfAborted();
  const start = Date.now();
  const revision = searchRevision();
  const capability = resolveCapability("quick");
  const cacheKey = `${revision}:${Math.floor(start / 300_000)}:${capability?.providerId}:${capability?.model}:${query.trim().toLowerCase()}`;
  const cached = getCachedSearch(cacheKey);
  if (cached)
    return {
      ...cached,
      matches: cached.matches as HydratedMatch[],
      cached: true,
    };
  const keyword = searchService.searchFts(query);
  if (isNameLookup(query, keyword)) {
    const result = { matches: keyword, fallback: false };
    setCachedSearch(cacheKey, result);
    return result;
  }
  emit?.({
    phase: "instant",
    matches: keyword,
    fallback: true,
    latencyMs: Date.now() - start,
  });
  let result: SearchResult;
  try {
    result = await withTimeout(
      async (budget) => {
        const retrieval = await hybridRetrieval(query, rid, budget);
        budget.throwIfAborted();
        if (!retrieval.candidates.length)
          return { matches: [], fallback: false };
        const candidates = [
          ...hydrateCandidates(
            retrieval.candidates.map((c) => c.contactId),
            PHASE1_LIMIT,
          ).values(),
        ];
        const verified = await rerankCandidates(
          query,
          buildCompressedCandidates(candidates),
          retrieval.plan,
          budget,
        );
        budget.throwIfAborted();
        const allowed = new Set(candidates.map((c) => c.id));
        const fresh = hydrateCandidates(
          verified
            .filter((match) => allowed.has(match.contact_id))
            .map((match) => match.contact_id),
          PHASE1_LIMIT,
        );
        return {
          matches: verified.flatMap((match) => {
            const contact = fresh.get(match.contact_id);
            return contact ? [{ ...contact, aiReason: match.reason }] : [];
          }),
          fallback: false,
        };
      },
      12_000,
      signal,
    );
  } catch (error) {
    signal?.throwIfAborted();
    log.warn(
      "SemanticSearch",
      `[${rid}] AI refinement unavailable: ${getErrorMessage(error)}`,
    );
    result = { matches: searchService.searchFts(query), fallback: true };
  }
  signal?.throwIfAborted();
  // A concurrent edit invalidates all evidence gathered before that edit.
  if (searchRevision() !== revision)
    return { matches: searchService.searchFts(query), fallback: true };
  if (!result.fallback) setCachedSearch(cacheKey, result);
  return result;
}

// =============================================================================
// FTS5 Keyword Search (sidebar quick-search, unchanged from v1)
// =============================================================================

export const searchService = {
  /**
   * FTS5 keyword search — used by the sidebar quick-search.
   * Simple, fast, exact-match search.
   */
  searchFts(q: string, filters: FacetFilter[] = []) {
    let allowed: Set<string> | undefined;
    if (filters.length) {
      const rows = sqlite
        .prepare(
          `SELECT c.id, c.role, c.company, c.location, c.industry, c.relationshipScore, c.updatedAt,
        (SELECT json_group_array(json_object('tag', tag)) FROM contact_tags WHERE contactId = c.id) AS tagsJson
        FROM contacts c WHERE ${ACTIVE_CONTACT_SQL}`,
        )
        .all() as {
        id: string;
        role: string | null;
        company: string | null;
        location: string | null;
        industry: string | null;
        relationshipScore: number | null;
        updatedAt: string;
        tagsJson: string;
      }[];
      allowed = new Set(
        rows
          .filter((row) =>
            filters.every((filter) =>
              matchesFacet({ ...row, tags: JSON.parse(row.tagsJson) }, filter),
            ),
          )
          .map((row) => row.id),
      );
    }
    const ids = lexicalSearch(q, 20, allowed).map((row) => row.contactId);
    return [...hydrateCandidates(ids, 20).values()];
  },

  /** Stream local candidates, then one terminal result. Never write after disconnect. */
  async semanticSearchStream(
    query: string,
    rid: string,
    res: Response,
    signal?: AbortSignal,
  ) {
    const send = (chunk: SearchChunk) => {
      if (!signal?.aborted && !res.destroyed && !res.writableEnded)
        res.write(JSON.stringify(chunk) + "\n");
    };
    try {
      const result = await runSearch(query, rid, send, signal);
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
  semanticSearch(query: string, rid: string, signal?: AbortSignal) {
    return runSearch(query, rid, undefined, signal);
  },
};
