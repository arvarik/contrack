// Recording, aggregation and the feed for the AI usage page.
//
// 1. recordInvocation()      writes each AI call to SQLite, and never throws,
//    so a failed record never breaks the AI call
// 2. getSummary()            totals, quota and cache tier stats
// 3. getFeed()               the paginated, filterable call history
// 4. cleanupOldInvocations() the 30-day retention sweep, at startup
//
// Raw prepared statements, not the Drizzle builder: recordInvocation runs for
// every AI call, and the aggregates read more naturally as SQL.

import { sqlite } from "../db.ts";
import { currentOwnerId } from "../tenancy/requestContext.ts";
import type { Scope } from "../tenancy/scope.ts";
import { log } from "../utils/logger.ts";
import { aiCache } from "../utils/aiCache.ts";
import { isAnyProviderConfigured } from "../ai/gateway.ts";
import { getProvider } from "../ai/providerRegistry.ts";
import { blendedCostPerM } from "../ai/pricing.ts";
import crypto from "crypto";

// Types

/** Valid operation values for the ai_invocations table (single source of truth). */
export const AI_OPERATIONS = [
  "briefing",
  "rerank",
  "mentions",
  "synthesis",
  "parse",
  "searchExpansion",
  "dailyInsight",
  "emlSummary",
  "connectorSummary",
  "bulkParse",
  "aiSearchGrounding",
  "aiSearchNoSearch",
  "aiSearchExtraction",
  "aiSearchReading",
  "aiSearchSinglePass",
  "queryParse",
  "hyde",
] as const;

export type AIOperation = (typeof AI_OPERATIONS)[number];

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

// Prepared statements

const insertStmt = sqlite.prepare(`
  INSERT INTO ai_invocations (id, operation, model, tokenCount, latencyMs, cached, description, ownerId, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
`);

const summaryStmt = sqlite.prepare(`
  SELECT
    COUNT(*) AS totalInvocations,
    COALESCE(SUM(CASE WHEN cached = 0 THEN 1 ELSE 0 END), 0) AS freshCalls,
    COALESCE(SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END), 0) AS cachedCalls,
    COALESCE(SUM(CASE WHEN cached = 0 THEN tokenCount ELSE 0 END), 0) AS totalTokens
  FROM ai_invocations
  WHERE ownerId = ?
`);

/** Per-model token aggregation for cost estimation. */
const costBreakdownStmt = sqlite.prepare(`
  SELECT model, SUM(tokenCount) AS tokens
  FROM ai_invocations
  WHERE ownerId = ? AND cached = 0 AND model IS NOT NULL AND tokenCount IS NOT NULL
  GROUP BY model
`);

/** Web research calls, fresh ones only, in the last 24 hours. */
const researchRunsStmt = sqlite.prepare(
  // tenant-lint: allow instance sweep
  `SELECT COUNT(*) AS n FROM ai_invocations
    WHERE operation IN ('aiSearchGrounding', 'aiSearchNoSearch', 'aiSearchSinglePass')
      AND cached = 0
      AND createdAt >= datetime('now', '-1 day')`,
);

/**
 * How many web research calls the instance made in the last 24 hours, with
 * any provider. The Enrichment page shows it, because each one is billed.
 */
export function researchRunsLastDay(): number {
  return (researchRunsStmt.get() as { n: number }).n;
}

const cleanupStmt = sqlite.prepare(
  // tenant-lint: allow instance sweep
  `DELETE FROM ai_invocations WHERE createdAt < datetime('now', '-30 days')`,
);

// Costs come from the list prices in ai/pricing.ts, one blended rate per model.

// Public API

/** Record one AI invocation, fresh or cached. Never throws. */
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
      // Outside a request this is the primary admin (currentOwnerId).
      currentOwnerId(),
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
 * One account's totals, the instance quota state and, for an admin, the cache
 * tier statistics. The counts, tokens and cost are the caller's own, read
 * through `idx_ai_inv_owner_created`. The cache tiers are one in-process LRU
 * shared by the instance, so their counters describe everybody's traffic and
 * only an admin gets them; for a member the field is left out, not faked.
 */
export function getSummary(scope: Scope, options: { admin: boolean }) {
  // 1. Session aggregates from ai_invocations
  const agg = summaryStmt.get(scope.ownerId) as {
    totalInvocations: number;
    freshCalls: number;
    cachedCalls: number;
    totalTokens: number;
  };

  // 2. Cost estimation: sum (tokens / 1M * costPerM) per model
  const costRows = costBreakdownStmt.all(scope.ownerId) as {
    model: string;
    tokens: number;
  }[];
  let estimatedCostUsd = 0;
  for (const row of costRows) {
    const costPerM = blendedCostPerM(row.model);
    estimatedCostUsd += (row.tokens / 1_000_000) * costPerM;
  }

  // 3. Cache hit rate
  const cacheHitRate =
    agg.totalInvocations > 0 ? agg.cachedCalls / agg.totalInvocations : 0;

  // 4. Live or mock. There is no tier to report: Google sets a key's tier from
  //    its Cloud project's billing and never says which, and OpenAI and
  //    Anthropic have none. What is known is whether Google answered with a
  //    free-tier quota error, which the page flags because Google uses
  //    free-tier prompts to improve its products.
  const tier: "LIVE" | "MOCK" = isAnyProviderConfigured() ? "LIVE" : "MOCK";
  const geminiSnapshot = getProvider("gemini")?.getQuotaSnapshot?.();
  const freeTier = geminiSnapshot?.freeTier ?? false;

  // 5. Gemini's usage meter (requests and tokens per model, grounded
  // requests today). Empty when Gemini is not connected.
  const quota = {
    models: geminiSnapshot?.models ?? {},
    grounding: { rpd: geminiSnapshot?.grounding.rpd ?? 0 },
  };

  // 6. Cache tier stats (in-memory, from aiCache). Admin only.
  const rawCacheStats = options.admin ? aiCache.getStats() : {};
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
    freeTier,
    quota,
    ...(options.admin ? { cacheTiers } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * A paginated feed of one account's AI invocations, filtered by operation,
 * cache status and sort direction.
 */
export function getFeed(scope: Scope, params: FeedParams) {
  const { offset, limit, operations, cached, sort } = params;

  // The owner is written into the statement text, not assembled with the
  // optional filters, so every shape of this query starts `WHERE ownerId = ?`,
  // uses `idx_ai_inv_owner_created`, and shows the predicate to the tenant
  // lint.
  const filters: string[] = [];
  const filterValues: unknown[] = [];

  if (operations && operations.length > 0) {
    const placeholders = operations.map(() => "?").join(", ");
    filters.push(`operation IN (${placeholders})`);
    filterValues.push(...operations);
  }

  if (cached !== undefined) {
    filters.push("cached = ?");
    filterValues.push(cached ? 1 : 0);
  }

  const filterClause = filters.map((f) => ` AND ${f}`).join("");
  const orderDirection = sort === "oldest" ? "ASC" : "DESC";
  const bindValues: unknown[] = [scope.ownerId, ...filterValues];

  // Items query
  const itemsQuery = sqlite.prepare(`
    SELECT id, operation, model, tokenCount, latencyMs, cached, description, createdAt
    FROM ai_invocations
    WHERE ownerId = ?${filterClause}
    ORDER BY createdAt ${orderDirection}
    LIMIT ? OFFSET ?
  `);

  // Count query (same filters, no LIMIT/OFFSET)
  const countQuery = sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM ai_invocations
    WHERE ownerId = ?${filterClause}
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
 * Delete invocations older than 30 days, once at startup.
 *
 * @returns the number of rows deleted, for the log.
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

// Instance-wide views, admin only. Two reads that cross accounts on purpose:
// the provider key is one key and the bill one bill, so the operator who pays
// it can see where it went. Only `GET /api/ai/stats/summary?scope=all` and the
// feed with `?scope=all` call them, and both refuse a member with 403
// ADMIN_REQUIRED first. Neither returns any text: `description` can carry a
// fragment of a contact's data, so the instance feed leaves it out. An admin
// needs to see that an account made 900 calls, not what it asked about.

/** One account's share of the instance's AI use. */
export interface UserUsage {
  userId: string;
  username: string | null;
  totalInvocations: number;
  freshCalls: number;
  cachedCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

function costOf(rows: { model: string | null; tokens: number }[]): number {
  let total = 0;
  for (const row of rows) {
    const perM = blendedCostPerM(row.model ?? "");
    total += (row.tokens / 1_000_000) * perM;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

/** Instance totals, and the same numbers broken down by account. */
export function getInstanceSummary(): {
  session: {
    totalInvocations: number;
    freshCalls: number;
    cachedCalls: number;
    totalTokens: number;
    estimatedCostUsd: number;
    cacheHitRate: number;
  };
  byUser: UserUsage[];
} {
  const totals = sqlite
    .prepare(
      // tenant-lint: allow admin cross-user
      `SELECT COUNT(*) AS totalInvocations,
              COALESCE(SUM(CASE WHEN cached = 0 THEN 1 ELSE 0 END), 0) AS freshCalls,
              COALESCE(SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END), 0) AS cachedCalls,
              COALESCE(SUM(CASE WHEN cached = 0 THEN tokenCount ELSE 0 END), 0) AS totalTokens
         FROM ai_invocations`,
    )
    .get() as {
    totalInvocations: number;
    freshCalls: number;
    cachedCalls: number;
    totalTokens: number;
  };

  const perModel = sqlite
    .prepare(
      // tenant-lint: allow admin cross-user
      `SELECT model, SUM(tokenCount) AS tokens FROM ai_invocations
        WHERE cached = 0 AND model IS NOT NULL AND tokenCount IS NOT NULL
        GROUP BY model`,
    )
    .all() as { model: string | null; tokens: number }[];

  const perOwner = sqlite
    .prepare(
      // tenant-lint: allow admin cross-user
      `SELECT i.ownerId AS userId, u.username AS username,
              COUNT(*) AS totalInvocations,
              COALESCE(SUM(CASE WHEN i.cached = 0 THEN 1 ELSE 0 END), 0) AS freshCalls,
              COALESCE(SUM(CASE WHEN i.cached = 1 THEN 1 ELSE 0 END), 0) AS cachedCalls,
              COALESCE(SUM(CASE WHEN i.cached = 0 THEN i.tokenCount ELSE 0 END), 0) AS totalTokens
         FROM ai_invocations i
         LEFT JOIN users u ON u.id = i.ownerId
        GROUP BY i.ownerId, u.username
        ORDER BY totalInvocations DESC`,
    )
    .all() as Omit<UserUsage, "estimatedCostUsd">[];

  const ownerModels = sqlite
    .prepare(
      // tenant-lint: allow admin cross-user
      `SELECT ownerId, model, SUM(tokenCount) AS tokens FROM ai_invocations
        WHERE cached = 0 AND model IS NOT NULL AND tokenCount IS NOT NULL
        GROUP BY ownerId, model`,
    )
    .all() as { ownerId: string; model: string | null; tokens: number }[];

  const byOwnerModels = new Map<
    string,
    { model: string | null; tokens: number }[]
  >();
  for (const row of ownerModels) {
    const list = byOwnerModels.get(row.ownerId) ?? [];
    list.push({ model: row.model, tokens: row.tokens });
    byOwnerModels.set(row.ownerId, list);
  }

  return {
    session: {
      ...totals,
      estimatedCostUsd: costOf(perModel),
      cacheHitRate:
        totals.totalInvocations > 0
          ? Math.round((totals.cachedCalls / totals.totalInvocations) * 1000) /
            1000
          : 0,
    },
    byUser: perOwner.map((row) => ({
      ...row,
      estimatedCostUsd: costOf(byOwnerModels.get(row.userId) ?? []),
    })),
  };
}

/**
 * The instance's invocations, newest first, with the account that made each.
 * `description` is not selected: it can hold a fragment of what somebody asked
 * about.
 */
export function getInstanceFeed(params: {
  offset: number;
  limit: number;
  operations?: string[];
  cached?: boolean;
  sort: "newest" | "oldest";
}) {
  const { offset, limit, operations, cached, sort } = params;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (operations && operations.length > 0) {
    filters.push(`i.operation IN (${operations.map(() => "?").join(", ")})`);
    values.push(...operations);
  }
  if (cached !== undefined) {
    filters.push("i.cached = ?");
    values.push(cached ? 1 : 0);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const direction = sort === "oldest" ? "ASC" : "DESC";

  const rows = sqlite
    .prepare(
      // tenant-lint: allow admin cross-user
      `SELECT i.id, i.operation, i.model, i.tokenCount, i.latencyMs, i.cached,
              i.createdAt, i.ownerId AS userId, u.username AS username
         FROM ai_invocations i
         LEFT JOIN users u ON u.id = i.ownerId
         ${where}
        ORDER BY i.createdAt ${direction}
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset) as {
    id: string;
    operation: string;
    model: string | null;
    tokenCount: number | null;
    latencyMs: number;
    cached: number;
    createdAt: string;
    userId: string;
    username: string | null;
  }[];

  const { cnt: totalCount } = sqlite
    .prepare(
      // tenant-lint: allow admin cross-user
      `SELECT COUNT(*) AS cnt FROM ai_invocations i ${where}`,
    )
    .get(...values) as { cnt: number };

  return {
    items: rows.map((row) => ({ ...row, cached: !!row.cached })),
    pagination: {
      offset,
      limit,
      totalCount,
      hasMore: offset + limit < totalCount,
    },
  };
}
