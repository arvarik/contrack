// =============================================================================
// Hybrid Retrieval Engine v3 — "Spotlight" Architecture
// =============================================================================
// The retrieval backbone of "Ask Contrack". Designed for sub-50ms latency
// on a ~960 contact local-first CRM.
//
// Key changes from v2:
// - SQL metadata is a PRE-FILTER (not a parallel RRF channel)
// - chrono-node for robust temporal NLP (not brittle regex)
// - Local embeddings via Transformers.js (zero API dependency)
// - RRF k=15 for sharper discrimination on small datasets
// - No hard K cap — returns ALL qualifying candidates
// - Weighted BM25 for column-priority FTS5 scoring
// - Short-circuit confidence detection for bypassing LLM reranker
//
// Pipeline:
//   1. Pre-filter extraction (chrono-node + regex → SQL WHERE clauses)
//   2. FTS5 keyword search (weighted BM25, on pre-filtered subset)
//   3. Local vector KNN (Transformers.js, on pre-filtered subset)
//   4. RRF fusion (k=15)
//   5. Confidence score → decides if LLM reranking is needed
// =============================================================================

import * as chrono from "chrono-node";
import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import {
  isLocalEmbeddingReady,
  embedText,
  findSearchNeighbors,
  getSearchEmbeddingCount,
} from "./localEmbeddings.ts";

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
  /** Pre-filter summary for debugging */
  preFilterSummary: string;
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
 * k=60 (industry standard) is for million-row indexes.
 * k=15 provides sharper discrimination for ~960 rows:
 * rank 1 score = 1/16 = 0.0625 vs rank 10 score = 1/25 = 0.04
 * (with k=60: rank 1 = 0.0164 vs rank 10 = 0.0143 — nearly flat)
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
 * High-confidence threshold: if N% or more of candidates came from
 * the FTS5 channel, the query is likely a keyword/exact match
 * and we can skip the LLM reranker.
 */
const HIGH_CONFIDENCE_FTS_RATIO = 0.85;

/**
 * Terms that follow "in" but are NOT locations.
 * Prevents false positives like "interested in AI" → location:AI.
 */
const NON_LOCATIONS = new Set([
  "ai", "tech", "fintech", "finance", "healthcare", "saas", "crypto",
  "marketing", "sales", "engineering", "design", "consulting", "trading",
  "business", "data", "science", "research", "management",
]);

/**
 * Generic terms that follow "works at" but are NOT specific company names.
 * Prevents false positives like "works at a startup" → company:"a startup".
 */
const NON_COMPANIES = new Set([
  "a startup", "a company", "a firm", "a bank", "a school",
  "a university", "a hospital", "an agency",
]);

// =============================================================================
// Phase 0: Pre-Filter Extraction
// =============================================================================

interface PreFilter {
  /** Contact IDs that pass the pre-filter, or null for "no filter" */
  contactIds: Set<string> | null;
  /** Human-readable summary */
  summary: string;
}

/**
 * Extract structured pre-filters from the query using chrono-node
 * for temporal parsing and regex for location/company.
 * Returns a whitelist of contactIds, or null if no filters apply.
 */
function extractPreFilters(query: string): PreFilter {
  const q = query.toLowerCase().trim();
  const conditions: string[] = [];
  const params: any[] = [];
  const summaryParts: string[] = [];

  // ── Temporal: chrono-node parses "last 3 months", "since Christmas", etc. ──
  const temporalResult = parseTemporalFilter(q);
  if (temporalResult) {
    conditions.push(temporalResult.sql);
    params.push(...temporalResult.params);
    summaryParts.push(temporalResult.summary);
  }

  // ── Location: "in London", "from New York", "based in SF" ─────────────────
  // CAREFUL: "interested in AI" should NOT match "AI" as a location.
  // We require location-specific prepositions and filter against NON_LOCATIONS.
  const locationMatch = q.match(
    /(?:^|\s)(?:located\s+in|based\s+in|live[s]?\s+in|living\s+in|from)\s+([A-Z][a-zA-Z\s]+?)(?:\s+(?:who|that|and|working|doing|\?|$))/i
  ) || q.match(
    /(?:^|\s)(?:located\s+in|based\s+in|live[s]?\s+in|living\s+in|from)\s+([A-Z][a-zA-Z\s,]+)$/i
  ) || q.match(
    /\b(?:contacts?|people|connections?|friends?|colleagues?|network)\s+in\s+([A-Z][a-zA-Z\s]+?)(?:\s+(?:who|that|and|working|doing|\?|$))/i
  );
  if (locationMatch) {
    const location = locationMatch[1].trim();
    if (location.length >= 3 && !NON_LOCATIONS.has(location.toLowerCase())) {
      conditions.push("location LIKE ?");
      params.push(`%${location}%`);
      summaryParts.push(`location:${location}`);
    }
  }

  // ── Company: "works at Google", "at Apple" ─────────────────────────────────
  // Careful: "works at a startup" should NOT become company:"a startup"
  const companyMatch = q.match(
    /(?:works?\s+at|at|from|employed\s+(?:at|by))\s+([A-Z][a-zA-Z\s&.]+?)(?:\s+(?:who|as|in|and|\?|$))/i
  );
  if (companyMatch) {
    const company = companyMatch[1].trim();
    if (company.length >= 2 && !NON_COMPANIES.has(company.toLowerCase())) {
      conditions.push("company LIKE ?");
      params.push(`%${company}%`);
      summaryParts.push(`company:${company}`);
    }
  }

  if (conditions.length === 0) {
    return { contactIds: null, summary: "none" };
  }

  // Execute the pre-filter query
  try {
    const whereClause = conditions.join(" AND ");
    const rows = sqlite.prepare(`
      SELECT id FROM contacts
      WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL
        AND ${whereClause}
    `).all(...params) as { id: string }[];

    const ids = new Set(rows.map(r => r.id));
    const summary = summaryParts.join(", ");
    return { contactIds: ids, summary: `${summary} (${ids.size} contacts)` };
  } catch (err: any) {
    log.warn("HybridRetrieval", `Pre-filter failed: ${err.message}`);
    return { contactIds: null, summary: "error" };
  }
}

/**
 * Parse temporal expressions using chrono-node.
 * Handles: "haven't contacted in 3 months", "since last fall",
 *          "not talked to since Christmas", "in the past 2 weeks"
 */
function parseTemporalFilter(q: string): { sql: string; params: string[]; summary: string } | null {
  // Check if this is a "haven't contacted" / "not contacted" type query
  const isNegativeTemporal = /(?:haven'?t|not|didn'?t)\s+(?:contacted?|spoken?|talked?|reached?|met|seen)/i.test(q);
  const isTimeBound = /(?:in\s+(?:the\s+)?(?:last|past)|since|for|over|ago)/i.test(q);

  if (!isNegativeTemporal && !isTimeBound) return null;

  // Use chrono-node to parse the temporal expression
  const now = new Date();
  const results = chrono.parse(q, now, { forwardDate: false });

  if (results.length > 0) {
    const parsedDate = results[0].start.date();
    const isoDate = parsedDate.toISOString().split("T")[0];

    return {
      sql: "(lastContactedAt IS NULL OR lastContactedAt < ?)",
      params: [isoDate],
      summary: `lastContact before ${isoDate}`,
    };
  }

  // Fallback to manual regex if chrono-node didn't parse
  const manualMatch = q.match(
    /(\d+)\s+(day|week|month|year)s?/i
  );
  if (manualMatch) {
    const amount = parseInt(manualMatch[1], 10);
    const unit = manualMatch[2].toLowerCase();
    const daysMap: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
    const days = amount * (daysMap[unit] ?? 30);

    return {
      sql: "(lastContactedAt IS NULL OR lastContactedAt < datetime('now', ?))",
      params: [`-${days} days`],
      summary: `lastContact > ${days} days ago`,
    };
  }

  return null;
}

// =============================================================================
// Channel 1: FTS5 Keyword Retrieval (Weighted BM25)
// =============================================================================

/**
 * Search the FTS5 index with weighted BM25 scoring.
 * Column weights prioritize name > company > role > rest.
 * Pre-filtered subset is applied post-query (FTS5 can't use WHERE on external tables).
 */
function ftsRetrieval(query: string, preFilterIds: Set<string> | null): RankedItem[] {
  const sanitized = query.replace(/['\"]/g, "").trim();
  if (!sanitized) return [];

  const tokens = sanitized.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return [];

  // Multiple FTS5 strategies, from most specific to most permissive
  const strategies = [
    // Strategy 1: Full phrase match
    `"${sanitized}"`,
    // Strategy 2: AND of individual token prefixes
    tokens.map(t => `"${t}"*`).join(" "),
    // Strategy 3: OR of individual tokens (most permissive)
    tokens.map(t => `"${t}"*`).join(" OR "),
  ];

  for (const ftsQuery of strategies) {
    try {
      const rows = sqlite.prepare(`
        SELECT contactId, bm25(contacts_fts, ${BM25_WEIGHTS}) as score
        FROM contacts_fts
        WHERE contacts_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `).all(ftsQuery, FTS_LIMIT) as { contactId: string; score: number }[];

      // Apply pre-filter
      const filtered = preFilterIds
        ? rows.filter(r => preFilterIds.has(r.contactId))
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
// Channel 2: Local Vector KNN Retrieval
// =============================================================================

/**
 * Embed the query using the local Transformers.js model and find
 * nearest neighbors in the search_embeddings table.
 * ~3-5ms total. Zero API calls.
 */
async function vectorRetrieval(
  query: string,
  preFilterIds: Set<string> | null,
): Promise<RankedItem[]> {
  if (!isLocalEmbeddingReady() || getSearchEmbeddingCount() === 0) {
    return [];
  }

  try {
    const queryVec = await embedText(query);
    if (!queryVec) return [];

    const neighbors = findSearchNeighbors(queryVec, VECTOR_LIMIT, preFilterIds ?? undefined);

    return neighbors.map((n, i) => ({
      contactId: n.contactId,
      rank: i + 1,
      channel: "vector" as const,
    }));
  } catch (err: any) {
    log.warn("HybridRetrieval", `Vector channel failed: ${err.message}`);
    return [];
  }
}

// =============================================================================
// Reciprocal Rank Fusion (RRF) — k=15 for small datasets
// =============================================================================

/**
 * Merge multiple ranked lists using Reciprocal Rank Fusion.
 *
 * RRF score: score(doc) = Σ 1/(k + rank_i)
 *
 * k=15 provides sharper discrimination than k=60 for ~960 rows.
 * A top-1 result gets score 1/16=0.0625 vs top-10 at 1/25=0.04 (~36% drop).
 * With k=60: top-1=0.0164 vs top-10=0.0143 (~13% drop — too flat).
 */
export function reciprocalRankFusion(
  rankedLists: RankedItem[][],
  limit?: number,
): RetrievalCandidate[] {
  const scoreMap = new Map<string, { score: number; channels: Set<"fts" | "vector"> }>();

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
 * Run the full v3 hybrid retrieval pipeline.
 *
 * 1. Pre-filter extraction   (chrono-node + regex → SQL WHERE, <1ms)
 * 2. FTS5 weighted search    (on pre-filtered subset, <1ms)
 * 3. Local vector KNN        (Transformers.js, ~3-5ms)
 * 4. RRF fusion (k=15)       (<1ms)
 * 5. Confidence assessment   (is LLM reranking needed?)
 *
 * Total: ~5-10ms. Zero API calls.
 */
export async function hybridRetrieval(
  query: string,
  rid: string,
): Promise<RetrievalResult> {
  const t0 = Date.now();

  // Phase 0: Extract pre-filters
  const preFilter = extractPreFilters(query);

  // If pre-filter returned 0 contacts, short-circuit
  if (preFilter.contactIds && preFilter.contactIds.size === 0) {
    log.info("HybridRetrieval", `[${rid}] Pre-filter returned 0 contacts (${preFilter.summary}), skipping`);
    return { candidates: [], highConfidence: false, preFilterSummary: preFilter.summary };
  }

  // Phase 1: Run FTS5 + Vector KNN (FTS is sync, vector is async)
  const [ftsResults, vectorResults] = await Promise.all([
    Promise.resolve(ftsRetrieval(query, preFilter.contactIds)),
    vectorRetrieval(query, preFilter.contactIds),
  ]);

  // Phase 2: RRF fusion (no limit — return all candidates)
  const fused = reciprocalRankFusion([ftsResults, vectorResults]);

  // Phase 3: Confidence assessment
  // If FTS dominates the results, this is likely an exact keyword query
  // and the LLM reranker is unnecessary overhead.
  const ftsCount = fused.filter(c => c.channels.includes("fts")).length;
  const highConfidence = fused.length > 0 &&
    (ftsCount / fused.length) >= HIGH_CONFIDENCE_FTS_RATIO &&
    ftsResults.length >= 2;

  const elapsed = Date.now() - t0;
  log.info(
    "HybridRetrieval",
    `[${rid}] "${query.slice(0, 60)}" → ` +
    `FTS:${ftsResults.length} + Vec:${vectorResults.length} ` +
    `→ ${fused.length} fused in ${elapsed}ms ` +
    `(preFilter: ${preFilter.summary}, confidence: ${highConfidence ? "HIGH" : "low"})`,
  );

  return {
    candidates: fused,
    highConfidence,
    preFilterSummary: preFilter.summary,
  };
}
