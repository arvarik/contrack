import { apiJson } from "./client";
/**
 * AI Stats API hooks — React Query hooks for the AI Stats Page.
 *
 * Two hooks matching the backend API contracts (ARCHITECTURE.md §11):
 * - useAIStatsSummary()  → GET /api/ai/stats/summary
 * - useAIStatsFeed()     → GET /api/ai/stats/feed
 */
import { useQuery, keepPreviousData } from "@tanstack/react-query";

// =============================================================================
// Types (match backend response shapes exactly)
// =============================================================================

export interface AIStatsSessionKPIs {
  totalInvocations: number;
  freshCalls: number;
  cachedCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cacheHitRate: number;
}

export interface AIStatsCacheTier {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
  ttlMs: number;
  maxEntries: number;
}

export interface AIStatsQuota {
  models: Record<string, { rpm: number; tpm: number; rpd: number }>;
  grounding: { rpd: number; limit: number; remaining: number };
}

/** One account's share of the instance's AI spending. */
export interface AIStatsUserUsage {
  userId: string;
  /** Null when the account has since been deleted but its rows have not. */
  username: string | null;
  totalInvocations: number;
  freshCalls: number;
  cachedCalls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface AIStatsSummary {
  session: AIStatsSessionKPIs;
  tier: "FREE" | "PAID" | "MOCK";
  quota: AIStatsQuota;
  /**
   * The shared in-process cache. Admin-only, and simply absent for a member,
   * which is why the accordion that renders it is already conditional.
   */
  cacheTiers?: Record<string, AIStatsCacheTier>;
  /** Present only for `scope: "all"`. */
  byUser?: AIStatsUserUsage[];
  scope?: "all";
  timestamp: string;
}

export interface AIStatsFeedItem {
  id: string;
  operation: string;
  model: string | null;
  tokenCount: number | null;
  latencyMs: number;
  cached: boolean;
  /**
   * Optional, because the instance feed does not send it.
   *
   * It is the one column that can carry a fragment of what somebody asked
   * about, and an operator reading the billing screen has no business seeing
   * another account's. Decision D10.
   */
  description?: string | null;
  createdAt: string;
  /** Present only on the instance feed. */
  userId?: string;
  username?: string | null;
}

export interface AIStatsFeedResponse {
  items: AIStatsFeedItem[];
  pagination: {
    offset: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  };
}

// =============================================================================
// Feed query params
// =============================================================================

export interface FeedQueryParams {
  offset?: number;
  limit?: number;
  operation?: string;
  cached?: "true" | "false";
  sort?: "newest" | "oldest";
  /**
   * `"all"` asks for the instance rather than the caller, and needs an admin.
   *
   * Never send it speculatively to find out whether somebody is an admin: a
   * member gets `403 ADMIN_REQUIRED`, which the shared client turns into a
   * toast on their screen.
   */
  scope?: "all";
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch aggregate AI usage summary (session KPIs, quota, cache tiers).
 * 30-second stale time — dashboard data that refreshes on each mount.
 */
export const useAIStatsSummary = (scope?: "all") => {
  return useQuery({
    // The scope is in the key. Without it the instance answer is served for
    // the personal view and back again, and the two are different numbers
    // with the same shape — which is the kind of wrong nobody notices.
    queryKey: ["aiStats", "summary", scope ?? "mine"],
    queryFn: ({ signal }): Promise<AIStatsSummary> =>
      apiJson<AIStatsSummary>(
        scope ? `/ai/stats/summary?scope=${scope}` : `/ai/stats/summary`,
        { signal },
      ),
    staleTime: 30_000,
  });
};

/**
 * Fetch paginated, filterable AI invocation feed.
 * Uses `placeholderData: keepPreviousData` for smooth pagination transitions.
 */
export const useAIStatsFeed = (params: FeedQueryParams = {}) => {
  // Build URLSearchParams from non-undefined values
  const searchParams = new URLSearchParams();
  if (params.offset !== undefined)
    searchParams.set("offset", String(params.offset));
  if (params.limit !== undefined)
    searchParams.set("limit", String(params.limit));
  if (params.operation) searchParams.set("operation", params.operation);
  if (params.cached) searchParams.set("cached", params.cached);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.scope) searchParams.set("scope", params.scope);

  const queryString = searchParams.toString();

  return useQuery({
    // `params` carries the scope, so the key already distinguishes the two.
    queryKey: ["aiStats", "feed", params],
    queryFn: ({ signal }): Promise<AIStatsFeedResponse> =>
      apiJson<AIStatsFeedResponse>(
        queryString ? `/ai/stats/feed?${queryString}` : `/ai/stats/feed`,
        { signal },
      ),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
};
