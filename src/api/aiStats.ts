/**
 * AI Stats API hooks — React Query hooks for the AI Stats Page.
 *
 * Two hooks matching the backend API contracts (ARCHITECTURE.md §11):
 * - useAIStatsSummary()  → GET /api/ai/stats/summary
 * - useAIStatsFeed()     → GET /api/ai/stats/feed
 */
import { useQuery, keepPreviousData } from "@tanstack/react-query";

const API_BASE = "/api/ai/stats";

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

export interface AIStatsSummary {
  session: AIStatsSessionKPIs;
  tier: "FREE" | "PAID" | "MOCK";
  quota: AIStatsQuota;
  cacheTiers: Record<string, AIStatsCacheTier>;
  timestamp: string;
}

export interface AIStatsFeedItem {
  id: string;
  operation: string;
  model: string | null;
  tokenCount: number | null;
  latencyMs: number;
  cached: boolean;
  description: string | null;
  createdAt: string;
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
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch aggregate AI usage summary (session KPIs, quota, cache tiers).
 * 30-second stale time — dashboard data that refreshes on each mount.
 */
export const useAIStatsSummary = () => {
  return useQuery({
    queryKey: ["aiStats", "summary"],
    queryFn: async (): Promise<AIStatsSummary> => {
      const res = await fetch(`${API_BASE}/summary`);
      if (!res.ok) throw new Error("Failed to fetch AI stats summary");
      return res.json();
    },
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

  const queryString = searchParams.toString();

  return useQuery({
    queryKey: ["aiStats", "feed", params],
    queryFn: async (): Promise<AIStatsFeedResponse> => {
      const url = queryString
        ? `${API_BASE}/feed?${queryString}`
        : `${API_BASE}/feed`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch AI stats feed");
      return res.json();
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
};
