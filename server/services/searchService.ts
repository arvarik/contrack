// =============================================================================
// Search Service — Ask Contrack v3 "Spotlight" Pipeline Orchestrator
// =============================================================================
// Orchestrates the full Ask Contrack search pipeline with two-phase delivery:
//
//   Cache → Pre-Filter → Hybrid Retrieval → Hydrate → Deliver Phase 1 (instant)
//                                                    → LLM Rerank → Deliver Phase 2 (async enriched)
//
// v3 "Spotlight" Architecture:
// - Phase 1 renders results to the user in <15ms (zero API calls)
// - Phase 2 streams AI reasons back asynchronously (~500ms later)
// - Short-circuit bypass: skip LLM for high-confidence keyword matches
// - SQL pre-filters via chrono-node, not parallel RRF channel
// - Local embeddings via Transformers.js, not Gemini API
//
// Graceful degradation at each stage:
// - Local model not loaded → skip vector channel, use FTS5 only
// - LLM reranking fails   → keep Phase 1 results (no AI reasons)
// - Everything fails       → FTS5 keyword fallback
// =============================================================================

import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { rerankCandidates, type CompressedContact } from "../ai/aiService.ts";
import { getCachedSearch, setCachedSearch } from "../utils/aiCache.ts";
import {
  hybridRetrieval,
  type RetrievalResult,
} from "./search/hybridRetrieval.ts";
import type { Response } from "express";
import { getErrorMessage } from "../utils/helpers.ts";
import { recordInvocation } from "./aiStatsService.ts";

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
    .prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`)
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
  candidateIds: string[],
  limit: number,
): CompressedContact[] {
  const tagsStmt = sqlite.prepare(
    "SELECT tag FROM contact_tags WHERE contactId = ?",
  );
  const interestsStmt = sqlite.prepare(
    "SELECT interest FROM contact_interests WHERE contactId = ?",
  );

  const compressed: CompressedContact[] = [];

  for (const id of candidateIds.slice(0, limit)) {
    const row = sqlite
      .prepare(
        "SELECT id, name, role, company, location, about, industry, preferences FROM contacts WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          name: string;
          role: string | null;
          company: string | null;
          location: string | null;
          about: string | null;
          industry: string | null;
          preferences: string | null;
        }
      | undefined;
    if (!row) continue;

    const tags = (tagsStmt.all(id) as { tag: string }[]).map((t) => t.tag);
    const interests = (interestsStmt.all(id) as { interest: string }[]).map(
      (t) => t.interest,
    );

    const entry: CompressedContact = { id: row.id, name: row.name };
    if (row.role) entry.role = row.role;
    if (row.company) entry.company = row.company;
    if (row.location) entry.location = row.location;
    if (row.about) entry.about = row.about;
    if (row.industry) entry.industry = row.industry;
    if (row.preferences) entry.preferences = row.preferences;
    if (tags.length || interests.length)
      entry.interests = [...tags, ...interests].join(", ");
    compressed.push(entry);
  }

  return compressed;
}

/**
 * Hydrate AI reranker results into full contact objects with AI reasons.
 */
function hydrateAiMatches(
  aiMatches: { contact_id: string; reason: string }[],
): HydratedMatch[] {
  if (!aiMatches.length) return [];
  const ids = aiMatches.map((m) => m.contact_id);
  const placeholders = ids.map(() => "?").join(",");

  const rows = sqlite
    .prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`)
    .all(ids);
  const hydratedRows = contactRepo.hydrateMany(rows);

  const hydratedMap = new Map(hydratedRows.map((r) => [r.id, r]));

  return aiMatches
    .map((m) => {
      const fullContact = hydratedMap.get(m.contact_id);
      if (!fullContact) return null;
      return { ...fullContact, aiReason: m.reason };
    })
    .filter(Boolean) as HydratedMatch[];
}

// =============================================================================
// FTS5 Keyword Search (sidebar quick-search, unchanged from v1)
// =============================================================================

export const searchService = {
  /**
   * FTS5 keyword search — used by the sidebar quick-search.
   * Simple, fast, exact-match search.
   */
  searchFts(q: string) {
    const safeQ = q.replace(/['"]/g, "");
    const results = sqlite
      .prepare(
        `
      SELECT c.* FROM contacts c
      JOIN contacts_fts fts ON c.id = fts.contactId
      WHERE contacts_fts MATCH ?
      ORDER BY rank LIMIT 20
    `,
      )
      .all(`"${safeQ}"*`);
    return contactRepo.hydrateMany(results);
  },

  // ===========================================================================
  // Ask Contrack v3 — Two-Phase Streaming Pipeline
  // ===========================================================================

  /**
   * Execute the full search pipeline and stream results in two phases:
   *
   * Phase 1 (instant, <15ms):
   *   Hybrid retrieval + hydration → send immediately (top 30 candidates)
   *
   * Phase 2 (async, ~500ms, optional):
   *   LLM reranks top candidates → stream enriched results
   *
   * Uses NDJSON (newline-delimited JSON) for streaming.
   */
  async semanticSearchStream(
    query: string,
    rid: string,
    res: Response,
    signal?: AbortSignal,
  ) {
    const startTime = Date.now();

    // ── 1. Cache check ─────────────────────────────────────────────────
    const cached = getCachedSearch(query);
    if (cached) {
      log.info(
        "SemanticSearch",
        `[${rid}] Cache HIT for "${query.trim().slice(0, 60)}" (${Date.now() - startTime}ms)`,
      );
      recordInvocation({
        operation: "rerank",
        latencyMs: Date.now() - startTime,
        cached: true,
        description: `Rerank cache hit: "${query.slice(0, 40)}"`,
      });
      res.write(
        JSON.stringify({
          phase: "complete",
          matches: cached.matches,
          fallback: cached.fallback,
          cached: true,
          latencyMs: Date.now() - startTime,
        }) + "\n",
      );
      res.end();
      return;
    }

    // ── 2. Hybrid retrieval (Stage 1) ──────────────────────────────────
    let retrieval: RetrievalResult;
    try {
      retrieval = await hybridRetrieval(query, rid);
    } catch (err: unknown) {
      log.error(
        "SemanticSearch",
        `[${rid}] Hybrid retrieval failed: ${getErrorMessage(err)}`,
      );
      res.write(
        JSON.stringify({
          phase: "complete",
          matches: [],
          fallback: true,
          cached: false,
          latencyMs: Date.now() - startTime,
        }) + "\n",
      );
      res.end();
      return;
    }

    if (retrieval.candidates.length === 0) {
      const elapsed = Date.now() - startTime;
      log.info(
        "SemanticSearch",
        `[${rid}] "${query}" → 0 candidates in ${elapsed}ms`,
      );
      res.write(
        JSON.stringify({
          phase: "complete",
          matches: [],
          fallback: false,
          cached: false,
          latencyMs: elapsed,
        }) + "\n",
      );
      res.end();
      return;
    }

    // ── 3. Hydrate top candidates ──────────────────────────────────────
    const candidateIds = retrieval.candidates.map((c) => c.contactId);
    const hydratedMap = hydrateCandidates(candidateIds, PHASE1_LIMIT);

    // ── 4. Phase 1 (instant) — Send hydrated results immediately ──────
    const phase1Matches = candidateIds
      .slice(0, PHASE1_LIMIT)
      .filter((id) => hydratedMap.has(id))
      .map((id) => hydratedMap.get(id));

    const phase1Elapsed = Date.now() - startTime;

    res.write(
      JSON.stringify({
        phase: "instant",
        matches: phase1Matches,
        fallback: false,
        cached: false,
        candidateCount: retrieval.candidates.length,
        highConfidence: retrieval.highConfidence,
        latencyMs: phase1Elapsed,
      }) + "\n",
    );

    log.info(
      "SemanticSearch",
      `[${rid}] Phase 1: "${query.slice(0, 50)}" → ${phase1Matches.length} results in ${phase1Elapsed}ms` +
        (retrieval.highConfidence ? " [HIGH CONFIDENCE — skipping LLM]" : ""),
    );

    // ── 5. Short-circuit: high-confidence → skip LLM ──────────────────
    if (retrieval.highConfidence) {
      // Cache the high-confidence result (no need for LLM enrichment)
      setCachedSearch(query, { matches: phase1Matches, fallback: false });
      recordInvocation({
        operation: "rerank",
        latencyMs: Date.now() - startTime,
        cached: false,
        description: `Search: High-confidence short-circuit (skipped LLM) for "${query.slice(0, 40)}"`,
      });
      res.write(
        JSON.stringify({
          phase: "complete",
          matches: phase1Matches,
          fallback: false,
          cached: false,
          skippedLlm: true,
          latencyMs: Date.now() - startTime,
        }) + "\n",
      );
      res.end();
      return;
    }

    // ── 6. Phase 2 (async) — LLM verification + rerank ─────────────────
    const compressedCandidates = buildCompressedCandidates(
      candidateIds,
      RERANKER_LIMIT,
    );

    try {
      const aiMatches = await rerankCandidates(
        query.trim(),
        compressedCandidates,
        retrieval.plan,
        signal,
      );

      if (aiMatches.length > 0) {
        const enrichedMatches = hydrateAiMatches(aiMatches);

        const totalElapsed = Date.now() - startTime;
        log.info(
          "SemanticSearch",
          `[${rid}] Phase 2: "${query.slice(0, 50)}" → ${enrichedMatches.length} AI-enriched results in ${totalElapsed}ms`,
        );

        const result = { matches: enrichedMatches, fallback: false };
        setCachedSearch(query, result);

        res.write(
          JSON.stringify({
            phase: "enriched",
            matches: enrichedMatches,
            fallback: false,
            cached: false,
            latencyMs: totalElapsed,
          }) + "\n",
        );
      } else {
        // LLM returned 0 matches — keep Phase 1 results
        setCachedSearch(query, { matches: phase1Matches, fallback: false });
      }
    } catch (aiErr: unknown) {
      log.warn(
        "SemanticSearch",
        `[${rid}] LLM reranker failed (${getErrorMessage(aiErr)}), keeping Phase 1 results`,
      );
      // Phase 1 results are already sent — no action needed
    }

    res.end();
  },

  // ===========================================================================
  // Non-streaming fallback (for tests or simple clients)
  // ===========================================================================

  /**
   * Ask Contrack v3 — non-streaming version.
   * Returns a single response after full pipeline completion.
   * Used by backward-compat clients or test harness.
   */
  async semanticSearch(query: string, rid: string) {
    const startTime = Date.now();

    // 1. Cache check
    const cached = getCachedSearch(query);
    if (cached) {
      log.info(
        "SemanticSearch",
        `[${rid}] Cache HIT for "${query.trim().slice(0, 60)}" (${Date.now() - startTime}ms)`,
      );
      recordInvocation({
        operation: "rerank",
        latencyMs: Date.now() - startTime,
        cached: true,
        description: `Rerank cache hit: "${query.slice(0, 40)}"`,
      });
      return { ...cached, cached: true };
    }

    // 2. Hybrid retrieval
    const retrieval = await hybridRetrieval(query, rid);

    if (retrieval.candidates.length === 0) {
      const elapsed = Date.now() - startTime;
      log.info(
        "SemanticSearch",
        `[${rid}] "${query}" → 0 candidates in ${elapsed}ms`,
      );
      return { matches: [], fallback: false, cached: false };
    }

    // 3. Hydrate candidates
    const candidateIds = retrieval.candidates.map((c) => c.contactId);
    const hydratedMap = hydrateCandidates(candidateIds, PHASE1_LIMIT);
    const hydratedPhase1 = candidateIds
      .slice(0, PHASE1_LIMIT)
      .map((id) => hydratedMap.get(id))
      .filter(Boolean);

    // 4. Short-circuit if high confidence
    if (retrieval.highConfidence) {
      const elapsed = Date.now() - startTime;
      log.info(
        "SemanticSearch",
        `[${rid}] v3 "${query}" → ${hydratedPhase1.length} results (high confidence, skipped LLM) in ${elapsed}ms`,
      );
      setCachedSearch(query, { matches: hydratedPhase1, fallback: false });
      recordInvocation({
        operation: "rerank",
        latencyMs: elapsed,
        cached: false,
        description: `Search: High-confidence short-circuit (skipped LLM) for "${query.slice(0, 40)}"`,
      });
      return { matches: hydratedPhase1, fallback: false, cached: false };
    }

    // 5. LLM verify + rerank
    const compressedCandidates = buildCompressedCandidates(
      candidateIds,
      RERANKER_LIMIT,
    );

    let fallback = false;
    try {
      const aiMatches = await rerankCandidates(
        query.trim(),
        compressedCandidates,
        retrieval.plan,
      );

      if (aiMatches.length > 0) {
        const enriched = hydrateAiMatches(aiMatches);

        const elapsed = Date.now() - startTime;
        log.info(
          "SemanticSearch",
          `[${rid}] v3 "${query}" → ${enriched.length} AI matches in ${elapsed}ms — caching`,
        );

        const result = { matches: enriched, fallback: false };
        setCachedSearch(query, result);
        return { ...result, cached: false };
      }
    } catch (err: unknown) {
      log.warn(
        "SemanticSearch",
        `[${rid}] LLM reranker failed, returning Stage 1 results`,
      );
      fallback = true;
    }

    // Fallback: return Phase 1 results
    if (fallback) {
      const capped = hydratedPhase1.slice(0, 15);
      return { matches: capped, fallback: true, cached: false };
    }

    // LLM returned 0 matches from candidates
    return { matches: [], fallback: false, cached: false };
  },
};
