// =============================================================================
// Hybrid Retrieval Engine v5 — "Plan → Filter → Rank → Verify"
// =============================================================================
// The retrieval backbone of "Ask Contrack" and the command palette AI mode.
// Designed for sub-1s latency on a ~960 contact local-first CRM.
//
// v5 changes (Plan/Verify architecture):
// - The LLM query planner emits a QueryPlan with `must` (hard) and `should`
//   (soft) buckets. `must.*Matchers` arrays are applied as HARD pre-filters
//   via word-boundary substring matching against the relevant contact field
//   BEFORE FTS5/vector run. This is the architectural fix for false
//   positives like "Sydney" surfacing on "Who lives in America?".
// - The QueryPlan is returned in RetrievalResult so the reranker can
//   verify per-filter and the synthesizer can ground its claims.
// - `should.traits` remains a soft RRF boost channel (descriptive intent).
// - When AI is unavailable OR the planner reports low confidence, we run
//   pure hybrid search (FTS + HyDE-vector) without hard filters — the
//   pipeline still produces results.
// - Removed the legacy regex `extractPreFilters` soft boost — the planner
//   subsumes it. Regex is no longer in the hot path.
//
// Carried over:
// - Local embeddings via Transformers.js (zero embed-side API dependency)
// - HyDE-expanded query for vector channel
// - RRF k=15 for sharper discrimination on small datasets
// - Weighted BM25 for column-priority FTS5 scoring
// - High-confidence FTS short-circuit (skip LLM rerank for exact matches)
//
// Pipeline:
//   1. Parallel LLM augmentation (parseSearchQuery → QueryPlan,
//      expandQueryForEmbedding → HyDE doc)
//   2. Build the candidate corpus:
//        - if plan has hard filters AND confidence != low:
//            JS-side word-boundary filter on relevant columns → Set<id>
//        - else: null (= no pre-filter, full corpus)
//   3. FTS5 weighted search (within filtered corpus, raw query)
//   4. Vector KNN of HyDE-expanded query (within filtered corpus)
//   5. should.traits soft boost channels (only over the filtered corpus)
//   6. RRF fusion (k=15) over all channels
//   7. Confidence signal → decides if LLM reranker is needed downstream
// =============================================================================

import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import {
  isLocalEmbeddingReady,
  embedText,
  findSearchNeighbors,
  getSearchEmbeddingCount,
} from "./localEmbeddings.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import {
  parseSearchQuery,
  expandQueryForEmbedding,
} from "../../ai/aiService.ts";
import type { QueryPlan } from "../../ai/types.ts";

// =============================================================================
// Types
// =============================================================================

export interface RetrievalCandidate {
  contactId: string;
  /** Fused RRF score (higher = more relevant) */
  score: number;
  /** Which channels contributed to this candidate */
  channels: ("fts" | "vector")[];
}

export interface RetrievalResult {
  candidates: RetrievalCandidate[];
  /** If true, FTS5 returned high-confidence exact matches — skip LLM reranker */
  highConfidence: boolean;
  /** Pre-filter summary for logs and debug UI. */
  preFilterSummary: string;
  /**
   * The LLM-extracted QueryPlan, or null when AI was unavailable / parse
   * failed. Downstream stages (rerank, synthesis) consume this to verify
   * candidates against the user's structured intent.
   */
  plan: QueryPlan | null;
}

interface RankedItem {
  contactId: string;
  rank: number;
  channel: "fts" | "vector";
}

// =============================================================================
// Constants
// =============================================================================

/**
 * RRF smoothing constant.
 * k=15 provides sharper discrimination than k=60 for ~960 rows:
 *   top-1 = 1/16 = 0.0625 vs top-10 = 1/25 = 0.04 (~36% drop)
 *   (k=60: top-1 = 0.0164 vs top-10 = 0.0143 — too flat)
 */
const RRF_K = 15;

/** Max results for FTS5 (generous — let BM25 scoring do the work) */
const FTS_LIMIT = 100;

/** Max vector neighbors */
const VECTOR_LIMIT = 100;

/**
 * BM25 column weights for FTS5.
 * Column order: name, company, role, headline, location, about, industry, extras, searchExpansion
 * A match in "name" (10x) is far more informative than "extras" (1x).
 */
const BM25_WEIGHTS = "10.0, 5.0, 3.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0";

/**
 * High-confidence threshold: if ≥ this fraction of candidates came from
 * the FTS5 channel, the query is likely a keyword/exact match
 * and we can skip the LLM reranker.
 */
const HIGH_CONFIDENCE_FTS_RATIO = 0.85;

/** Limit per soft boost channel — keeps RRF math bounded. */
const BOOST_LIMIT = 50;

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
  /** Per-dimension active matcher counts, for logging. */
  summary: string;
}

/**
 * Active contacts only — ghosts, archived contacts, and soft-merged
 * (canonical replaced) contacts are excluded from all search results.
 */
const ACTIVE_GATE_SQL = `isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL`;

/**
 * Compile a list of matchers into a single case-insensitive word-boundary
 * regex. Word boundary uses `(?:^|[^a-zA-Z0-9])` and `(?=[^a-zA-Z0-9]|$)`
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
    `(?:^|[^a-zA-Z0-9])(?:${parts.join("|")})(?=[^a-zA-Z0-9]|$)`,
    "i",
  );
}

/**
 * Apply the QueryPlan's `must` filters as a hard pre-filter against the
 * active contact corpus. Returns the set of allowed contact IDs, or null
 * if no filters apply.
 */
function applyHardFilters(plan: QueryPlan): HardFilterResult {
  // Low-confidence parses skip hard filters entirely — exploratory queries
  // shouldn't get gated on a possibly-wrong extraction.
  if (plan.confidence === "low") {
    return { allowedIds: null, summary: "low-confidence (no hard filter)" };
  }

  const locRe = buildMatcherRegex(plan.must.locationMatchers ?? []);
  const coRe = buildMatcherRegex(plan.must.companyMatchers ?? []);
  const roleRe = buildMatcherRegex(plan.must.roleMatchers ?? []);
  const indRe = buildMatcherRegex(plan.must.industryMatchers ?? []);
  const temporal = plan.must.temporal;

  if (!locRe && !coRe && !roleRe && !indRe && !temporal) {
    return { allowedIds: null, summary: "no hard filters" };
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
  // we also fetch tags + interests inline as a coalesced text blob.
  const rows = sqlite
    .prepare(
      `
      SELECT
        c.id,
        c.location,
        c.company,
        c.role,
        c.headline,
        c.industry,
        COALESCE(GROUP_CONCAT(DISTINCT t.tag), '')      AS tagsText,
        COALESCE(GROUP_CONCAT(DISTINCT i.interest), '') AS interestsText
      FROM contacts c
      LEFT JOIN contact_tags t      ON t.contactId = c.id
      LEFT JOIN contact_interests i ON i.contactId = c.id
      WHERE ${ACTIVE_GATE_SQL}${temporalSql}
      GROUP BY c.id
    `,
    )
    .all(...temporalParams) as {
    id: string;
    location: string | null;
    company: string | null;
    role: string | null;
    headline: string | null;
    industry: string | null;
    tagsText: string;
    interestsText: string;
  }[];

  const allowed = new Set<string>();
  for (const r of rows) {
    if (locRe && !(r.location && locRe.test(r.location))) continue;
    if (coRe && !(r.company && coRe.test(r.company))) continue;
    if (roleRe) {
      const inRole = r.role && roleRe.test(r.role);
      const inHeadline = r.headline && roleRe.test(r.headline);
      if (!inRole && !inHeadline) continue;
    }
    if (indRe) {
      const inIndustry = r.industry && indRe.test(r.industry);
      const inTags = r.tagsText && indRe.test(r.tagsText);
      const inInterests = r.interestsText && indRe.test(r.interestsText);
      if (!inIndustry && !inTags && !inInterests) continue;
    }
    allowed.add(r.id);
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
    allowedIds: allowed,
    summary: `${summaryParts.join("+")}=${allowed.size}`,
  };
}

// =============================================================================
// Phase 1a: FTS5 Keyword Retrieval (Weighted BM25)
// =============================================================================

function ftsRetrieval(
  query: string,
  preFilterIds: Set<string> | null,
): RankedItem[] {
  const sanitized = query.replace(/['\"]/g, "").trim();
  if (!sanitized) return [];

  const tokens = sanitized.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const strategies = [
    `"${sanitized}"`,
    tokens.map((t) => `"${t}"*`).join(" "),
    tokens.map((t) => `"${t}"*`).join(" OR "),
  ];

  for (const ftsQuery of strategies) {
    try {
      const rows = sqlite
        .prepare(
          `
        SELECT contactId, bm25(contacts_fts, ${BM25_WEIGHTS}) as score
        FROM contacts_fts
        WHERE contacts_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `,
        )
        .all(ftsQuery, FTS_LIMIT) as { contactId: string; score: number }[];

      const filtered = preFilterIds
        ? rows.filter((r) => preFilterIds.has(r.contactId))
        : rows;

      if (filtered.length > 0) {
        return filtered.map((r, i) => ({
          contactId: r.contactId,
          rank: i + 1,
          channel: "fts" as const,
        }));
      }
    } catch {
      // FTS5 syntax errors — continue to next strategy
    }
  }

  return [];
}

// =============================================================================
// Phase 1b: Local Vector KNN Retrieval (HyDE-expanded query)
// =============================================================================

async function vectorRetrieval(
  embedInputText: string,
  preFilterIds: Set<string> | null,
): Promise<RankedItem[]> {
  if (!isLocalEmbeddingReady() || getSearchEmbeddingCount() === 0) {
    return [];
  }

  try {
    const queryVec = await embedText(embedInputText);
    if (!queryVec) return [];

    const neighbors = findSearchNeighbors(
      queryVec,
      VECTOR_LIMIT,
      preFilterIds ?? undefined,
    );

    return neighbors.map((n, i) => ({
      contactId: n.contactId,
      rank: i + 1,
      channel: "vector" as const,
    }));
  } catch (err: unknown) {
    log.warn(
      "HybridRetrieval",
      `Vector channel failed: ${getErrorMessage(err)}`,
    );
    return [];
  }
}

// =============================================================================
// Phase 1c: Soft Boost Channels (should.traits)
// =============================================================================
// Traits are a SOFT signal — a contact matching multiple traits ranks
// higher but is not gated on them. Each trait becomes its own ranked list
// in the RRF fusion. Always intersected with the hard pre-filter set
// (if any) so boosts can't surface excluded contacts.

function buildTraitBoosts(
  plan: QueryPlan,
  allowedIds: Set<string> | null,
): RankedItem[][] {
  const traits = plan.should.traits ?? [];
  if (traits.length === 0) return [];

  const channels: RankedItem[][] = [];

  for (const trait of traits) {
    try {
      const rows = sqlite
        .prepare(
          `
          SELECT DISTINCT c.id
          FROM contacts c
          LEFT JOIN contact_tags t      ON t.contactId = c.id
          LEFT JOIN contact_interests i ON i.contactId = c.id
          WHERE c.isGhost = 0
            AND (c.isArchived = 0 OR c.isArchived IS NULL)
            AND c.canonicalId IS NULL
            AND (
              c.about LIKE ? OR c.preferences LIKE ? OR c.headline LIKE ?
              OR c.searchExpansion LIKE ?
              OR t.tag LIKE ? OR i.interest LIKE ?
            )
          LIMIT ?
        `,
        )
        .all(
          `%${trait}%`,
          `%${trait}%`,
          `%${trait}%`,
          `%${trait}%`,
          `%${trait}%`,
          `%${trait}%`,
          BOOST_LIMIT,
        ) as { id: string }[];

      const items: RankedItem[] = rows
        .filter((r) => !allowedIds || allowedIds.has(r.id))
        .map((r) => ({
          contactId: r.id,
          rank: 1,
          channel: "vector" as const,
        }));

      if (items.length > 0) channels.push(items);
    } catch (err: unknown) {
      log.warn(
        "HybridRetrieval",
        `Trait boost failed for "${trait}": ${getErrorMessage(err)}`,
      );
    }
  }

  return channels;
}

// =============================================================================
// Reciprocal Rank Fusion (RRF)
// =============================================================================

export function reciprocalRankFusion(
  rankedLists: RankedItem[][],
  limit?: number,
): RetrievalCandidate[] {
  const scoreMap = new Map<
    string,
    { score: number; channels: Set<"fts" | "vector"> }
  >();

  for (const list of rankedLists) {
    for (const item of list) {
      const entry = scoreMap.get(item.contactId) ?? {
        score: 0,
        channels: new Set<"fts" | "vector">(),
      };
      entry.score += 1 / (RRF_K + item.rank);
      entry.channels.add(item.channel);
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

  candidates.sort((a, b) => b.score - a.score);
  return limit ? candidates.slice(0, limit) : candidates;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Run the v5 hybrid retrieval pipeline.
 *
 * 1. Parallel LLM augmentation:
 *      a. parseSearchQuery   → QueryPlan  (~150-300ms, cached 24h)
 *      b. expandQueryForEmbedding → HyDE doc (~150-300ms, cached 24h)
 *    Both gracefully degrade — pipeline still runs without them.
 *
 * 2. Hard pre-filter: QueryPlan.must.*Matchers applied JS-side via
 *    word-boundary regex. Empty result set short-circuits the search.
 *
 * 3. FTS5 weighted BM25 within the filtered corpus.
 * 4. Local vector KNN of HyDE-expanded query within the filtered corpus.
 * 5. should.traits soft boost channels within the filtered corpus.
 * 6. RRF fusion (k=15).
 * 7. High-confidence detection for downstream LLM rerank decision.
 *
 * Total: ~300-600ms with AI (cache cold), ~10-30ms cached.
 */
export async function hybridRetrieval(
  query: string,
  rid: string,
): Promise<RetrievalResult> {
  const t0 = Date.now();

  const [plan, hypoDoc] = await Promise.all([
    parseSearchQuery(query),
    expandQueryForEmbedding(query),
  ]);

  // ── Phase 0: hard pre-filter ──────────────────────────────────────────
  let allowedIds: Set<string> | null = null;
  let hardFilterSummary = "skipped (no plan)";
  if (plan) {
    const hf = applyHardFilters(plan);
    allowedIds = hf.allowedIds;
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
      };
    }
  }

  const embedInput = hypoDoc ?? query;
  const usingHyde = !!hypoDoc;

  // ── Phase 1: parallel retrieval (within filtered corpus) ──────────────
  const [ftsResults, vectorResults] = await Promise.all([
    Promise.resolve(ftsRetrieval(query, allowedIds)),
    vectorRetrieval(embedInput, allowedIds),
  ]);

  // ── Phase 1c: soft boost channels (traits) ─────────────────────────────
  const traitBoosts = plan ? buildTraitBoosts(plan, allowedIds) : [];

  // ── Phase 2: RRF fusion across FTS + vector + trait boosts ────────────
  const fused = reciprocalRankFusion([
    ftsResults,
    vectorResults,
    ...traitBoosts,
  ]);

  // ── Phase 3: confidence assessment ─────────────────────────────────────
  // Dominant FTS = exact keyword match → LLM reranker is unnecessary.
  // We also skip the short-circuit when hard filters are active and the
  // result set is large enough that the rerank-as-verifier is worth doing.
  const ftsCount = fused.filter((c) => c.channels.includes("fts")).length;
  const highConfidence =
    fused.length > 0 &&
    ftsCount / fused.length >= HIGH_CONFIDENCE_FTS_RATIO &&
    ftsResults.length >= 2 &&
    // Hard filters mean we WANT the LLM verifier to run — don't bypass.
    allowedIds === null;

  const elapsed = Date.now() - t0;
  log.info(
    "HybridRetrieval",
    `[${rid}] "${query.slice(0, 60)}" → ` +
      `FTS:${ftsResults.length} + Vec:${vectorResults.length}` +
      `${usingHyde ? "(hyde)" : "(raw)"}` +
      ` + Traits:${traitBoosts.length}ch ` +
      `→ ${fused.length} fused in ${elapsed}ms ` +
      `(plan: ${plan ? `conf=${plan.confidence}` : "none"}, ` +
      `filter: ${hardFilterSummary}, ` +
      `confidence: ${highConfidence ? "HIGH" : "low"})`,
  );

  return {
    candidates: fused,
    highConfidence,
    preFilterSummary: hardFilterSummary,
    plan,
  };
}
