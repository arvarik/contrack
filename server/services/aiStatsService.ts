// =============================================================================
// AI Stats Service — Invocation Recording, Aggregation & Feed Queries
// =============================================================================
// This service is the backend engine for the AI Stats Page (/settings/ai-stats).
// It provides three capabilities:
//
// 1. recordInvocation() — fire-and-forget write of each AI call to SQLite
// 2. getSummary()       — aggregate KPIs + quota + cache tier stats
// 3. getFeed()          — paginated, filterable invocation history
// 4. cleanupOldInvocations() — 30-day retention sweep (runs on startup)
//
// DESIGN DECISIONS:
// - Uses raw better-sqlite3 prepared statements (not Drizzle query builder)
//   for performance on the hot path (recordInvocation is called for every
//   AI operation) and for the aggregate queries which use SQL features
//   (GROUP BY, dynamic WHERE) that are more natural in raw SQL.
// - recordInvocation() is synchronous and wrapped in try/catch. It NEVER
//   throws — a failed recording must never break the actual AI operation.
// =============================================================================

import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { aiCache } from "../utils/aiCache.ts";
import { isProviderConfigured } from "../ai/singleton.ts";
import { ai, activeProviderName } from "../ai/index.ts";
import { getAITier, GEMINI_REGISTRY } from "../ai/routing/registry.ts";
import crypto from "crypto";

// =============================================================================
// Types
// =============================================================================

/** Valid operation values for the ai_invocations table. */
export type AIOperation =
  | "briefing"
  | "rerank"
  | "mentions"
  | "synthesis"
  | "parse"
  | "searchExpansion"
  | "dailyInsight"
  | "emlSummary"
  | "bulkParse"
  | "aiSearchGrounding"
  | "aiSearchExtraction"
  | "aiSearchSinglePass";

/** Input shape for recording a single AI invocation. */
export interface InvocationEntry {
  operation: AIOperation;
  model?: string | null;
  tokenCount?: number | null;
  latencyMs: number;
  cached: boolean;
  description?: string | null;
}

/** A single feed item as returned by getFeed(). */
export interface FeedItem {
  id: string;
  operation: string;
  model: string | null;
  tokenCount: number | null;
  latencyMs: number;
  cached: boolean;
  description: string | null;
  createdAt: string;
}

/** Filter/pagination params for getFeed(). */
export interface FeedParams {
  offset: number;
  limit: number;
  operations?: string[];
  cached?: boolean;
  sort: "newest" | "oldest";
}

// =============================================================================
// Prepared Statements
// =============================================================================

const insertStmt = sqlite.prepare(`
  INSERT INTO ai_invocations (id, operation, model, tokenCount, latencyMs, cached, description, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
`);

const summaryStmt = sqlite.prepare(`
  SELECT
    COUNT(*) AS totalInvocations,
    COALESCE(SUM(CASE WHEN cached = 0 THEN 1 ELSE 0 END), 0) AS freshCalls,
    COALESCE(SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END), 0) AS cachedCalls,
    COALESCE(SUM(CASE WHEN cached = 0 THEN tokenCount ELSE 0 END), 0) AS totalTokens
  FROM ai_invocations
`);

/** Per-model token aggregation for cost estimation. */
const costBreakdownStmt = sqlite.prepare(`
  SELECT model, SUM(tokenCount) AS tokens
  FROM ai_invocations
  WHERE cached = 0 AND model IS NOT NULL AND tokenCount IS NOT NULL
  GROUP BY model
`);

const cleanupStmt = sqlite.prepare(`
  DELETE FROM ai_invocations WHERE createdAt < datetime('now', '-30 days')
`);

const countStmt = sqlite.prepare(`
  SELECT COUNT(*) AS cnt FROM ai_invocations
`);

// =============================================================================
// Cost Lookup — Build a model→costPerM map from all provider registries
// =============================================================================

const costPerMMap = new Map<string, number>();

// Gemini models (from registry)
for (const model of GEMINI_REGISTRY) {
  costPerMMap.set(model.id, model.costPerM);
}

// OpenAI models — average of (input + output) cost per 1M tokens
// Source: ARCHITECTURE.md §2 Model Ledger
costPerMMap.set("gpt-4o-mini", 0.375); // avg($0.15 in, $0.60 out)
costPerMMap.set("gpt-5.4-mini", 2.625); // avg($0.75 in, $4.50 out)
costPerMMap.set("gpt-5.4", 8.75); // avg($2.50 in, $15.00 out)

// Anthropic models — average of (input + output) cost per 1M tokens
costPerMMap.set("claude-haiku-4.5", 3.0); // avg($1.00 in, $5.00 out)
costPerMMap.set("claude-sonnet-4.6", 9.0); // avg($3.00 in, $15.00 out)
costPerMMap.set("claude-opus-4.6", 15.0); // avg($5.00 in, $25.00 out)

// =============================================================================
// Public API
// =============================================================================

/**
 * Record a single AI invocation. Fire-and-forget — never throws.
 * Called after every AI function completes (both fresh calls and cache hits).
 */
export function recordInvocation(entry: InvocationEntry): void {
  try {
    const id = crypto.randomUUID();
    insertStmt.run(
      id,
      entry.operation,
      entry.model ?? null,
      entry.tokenCount ?? null,
      entry.latencyMs,
      entry.cached ? 1 : 0,
      entry.description ?? null,
    );
    log.debug(
      "AIStats",
      `Recorded invocation: ${entry.operation} (id: ${id.slice(0, 8)}, cached: ${entry.cached})`,
    );
  } catch (err: unknown) {
    // Log but NEVER throw — recording failures must not break AI operations
    log.error(
      "AIStats",
      `Failed to record invocation: ${(err as Error).message}`,
    );
  }
}

/**
 * Get aggregate summary KPIs, quota state, and cache tier statistics.
 * Powers the Summary Bar and KPI Row on the AI Stats page.
 */
export function getSummary() {
  // 1. Session aggregates from ai_invocations
  const agg = summaryStmt.get() as {
    totalInvocations: number;
    freshCalls: number;
    cachedCalls: number;
    totalTokens: number;
  };

  // 2. Cost estimation: sum (tokens / 1M * costPerM) per model
  const costRows = costBreakdownStmt.all() as {
    model: string;
    tokens: number;
  }[];
  let estimatedCostUsd = 0;
  for (const row of costRows) {
    const costPerM = costPerMMap.get(row.model) ?? 0;
    estimatedCostUsd += (row.tokens / 1_000_000) * costPerM;
  }

  // 3. Cache hit rate
  const cacheHitRate =
    agg.totalInvocations > 0 ? agg.cachedCalls / agg.totalInvocations : 0;

  // 4. Tier — provider-aware (F-07)
  // For Gemini: show FREE/PAID tier from AI_TIER env var
  // For OpenAI/Anthropic: show provider name (always paid, no free tier concept)
  let tier: string;
  if (!isProviderConfigured) {
    tier = "MOCK";
  } else if (activeProviderName === "gemini") {
    tier = getAITier();
  } else {
    tier = activeProviderName.toUpperCase(); // "OPENAI" or "ANTHROPIC"
  }

  // 5. Quota snapshot (safe for all providers via barrel export)
  const quotaSnapshot = ai.getQuotaSnapshot();
  const quota = {
    models: quotaSnapshot.models,
    grounding: quotaSnapshot.grounding,
  };

  // 6. Cache tier stats (in-memory, from aiCache)
  const rawCacheStats = aiCache.getStats();
  const cacheTiers: Record<
    string,
    {
      entries: number;
      hits: number;
      misses: number;
      evictions: number;
      hitRate: number;
      ttlMs: number;
      maxEntries: number;
    }
  > = {};

  for (const [tierName, tierData] of Object.entries(rawCacheStats)) {
    if (tierName === "batchMode") continue; // skip batch mode metadata
    const data = tierData as {
      entries: number;
      hits: number;
      misses: number;
      evictions: number;
      ttlMs: number;
      maxEntries: number;
    };
    const total = data.hits + data.misses;
    cacheTiers[tierName] = {
      entries: data.entries,
      hits: data.hits,
      misses: data.misses,
      evictions: data.evictions,
      hitRate: total > 0 ? data.hits / total : 0,
      ttlMs: data.ttlMs,
      maxEntries: data.maxEntries,
    };
  }

  return {
    session: {
      totalInvocations: agg.totalInvocations,
      freshCalls: agg.freshCalls,
      cachedCalls: agg.cachedCalls,
      totalTokens: agg.totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000, // 6 decimal places
      cacheHitRate: Math.round(cacheHitRate * 1000) / 1000, // 3 decimal places
    },
    tier,
    quota,
    cacheTiers,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get a paginated, filterable feed of AI invocations.
 * Supports filtering by operation type(s), cache status, and sort direction.
 */
export function getFeed(params: FeedParams) {
  const { offset, limit, operations, cached, sort } = params;

  // Build dynamic WHERE clauses
  const conditions: string[] = [];
  const bindValues: unknown[] = [];

  if (operations && operations.length > 0) {
    const placeholders = operations.map(() => "?").join(", ");
    conditions.push(`operation IN (${placeholders})`);
    bindValues.push(...operations);
  }

  if (cached !== undefined) {
    conditions.push("cached = ?");
    bindValues.push(cached ? 1 : 0);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const orderDirection = sort === "oldest" ? "ASC" : "DESC";

  // Items query
  const itemsQuery = sqlite.prepare(`
    SELECT id, operation, model, tokenCount, latencyMs, cached, description, createdAt
    FROM ai_invocations
    ${whereClause}
    ORDER BY createdAt ${orderDirection}
    LIMIT ? OFFSET ?
  `);

  // Count query (same filters, no LIMIT/OFFSET)
  const countQuery = sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM ai_invocations
    ${whereClause}
  `);

  const rawItems = itemsQuery.all(...bindValues, limit, offset) as Array<{
    id: string;
    operation: string;
    model: string | null;
    tokenCount: number | null;
    latencyMs: number;
    cached: number;
    description: string | null;
    createdAt: string;
  }>;

  const { cnt: totalCount } = countQuery.get(...bindValues) as { cnt: number };

  // Convert SQLite 0/1 to boolean
  const items: FeedItem[] = rawItems.map((row) => ({
    ...row,
    cached: !!row.cached,
  }));

  return {
    items,
    pagination: {
      offset,
      limit,
      totalCount,
      hasMore: offset + limit < totalCount,
    },
  };
}

/**
 * Delete invocations older than 30 days. Called once on server startup.
 * Returns the number of rows deleted for logging.
 */
export function cleanupOldInvocations(): number {
  try {
    const result = cleanupStmt.run();
    if (result.changes > 0) {
      log.info(
        "AIStats",
        `Retention cleanup: deleted ${result.changes} invocations older than 30 days`,
      );
    }
    return result.changes;
  } catch (err: unknown) {
    log.error("AIStats", `Retention cleanup failed: ${(err as Error).message}`);
    return 0;
  }
}
