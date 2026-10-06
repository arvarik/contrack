/** Hooks for the AI usage page: `/api/ai/stats/summary` and `/feed`. */
import { apiJson } from "./client";
import {
  useInfiniteQuery,
  useQuery,
  keepPreviousData,
} from "@tanstack/react-query";

// Types. These match the server's answers exactly.

interface AIStatsSessionKPIs {
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

/** Gemini's usage meter. Empty when Gemini is not connected. */
interface AIStatsQuota {
  models: Record<string, { rpm: number; tpm: number; rpd: number }>;
  /** Grounded requests sent today. */
  grounding: { rpd: number };
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
  /** "MOCK" when no provider is connected and every AI call is simulated. */
  tier: "LIVE" | "MOCK";
  /** Google answered the Gemini key with a free-tier quota error. */
  freeTier: boolean;
  quota: AIStatsQuota;
  /** The shared in-process cache. Admins only: absent for a member. */
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
   * Absent from the instance feed: it can carry a fragment of what somebody
   * asked, and an admin must not read another account's.
   */
  description?: string | null;
  createdAt: string;
  /** Present only on the instance feed. */
  userId?: string;
  username?: string | null;
}

interface AIStatsFeedResponse {
  items: AIStatsFeedItem[];
  pagination: {
    offset: number;
    limit: number;
    totalCount: number;
    hasMore: boolean;
  };
}

export interface FeedQueryParams {
  offset?: number;
  limit?: number;
  operation?: string;
  cached?: "true" | "false";
  sort?: "newest" | "oldest";
  /**
   * `"all"` asks for the instance, and needs an admin. Never send it to find
   * out whether somebody is one: a member gets `403 ADMIN_REQUIRED`.
   */
  scope?: "all";
}

/** The AI usage summary: session numbers, quota and cache tiers. */
export const useAIStatsSummary = (scope?: "all") => {
  return useQuery({
    // The scope is in the key: the instance and personal answers have the
    // same shape and different numbers.
    queryKey: ["aiStats", "summary", scope ?? "mine"],
    queryFn: ({ signal }): Promise<AIStatsSummary> =>
      apiJson<AIStatsSummary>(
        scope ? `/ai/stats/summary?scope=${scope}` : `/ai/stats/summary`,
        { signal },
      ),
    staleTime: 30_000,
  });
};

/** Rows per feed page. Here, in the module that pages, and nowhere else. */
export const FEED_PAGE_SIZE = 50;

/**
 * The AI call feed. "Load older activity" appends a page rather than
 * replacing the rows on screen: a person scans a log downward for the entry
 * that explains a cost.
 *
 * The query keeps the offset, so a filter change starts a new query and the
 * list resets. The previous list stays on screen while the new one loads.
 */
export const useAIStatsFeed = (params: FeedQueryParams = {}) => {
  const limit = params.limit ?? FEED_PAGE_SIZE;

  const urlFor = (offset: number): string => {
    const searchParams = new URLSearchParams();
    searchParams.set("offset", String(offset));
    searchParams.set("limit", String(limit));
    if (params.operation) searchParams.set("operation", params.operation);
    if (params.cached) searchParams.set("cached", params.cached);
    if (params.sort) searchParams.set("sort", params.sort);
    if (params.scope) searchParams.set("scope", params.scope);
    return `/ai/stats/feed?${searchParams.toString()}`;
  };

  const query = useInfiniteQuery({
    // Not the offset: it is the cursor inside this query, and in the key it
    // would make each page a separate cache entry.
    queryKey: [
      "aiStats",
      "feed",
      {
        limit,
        operation: params.operation,
        cached: params.cached,
        sort: params.sort,
        scope: params.scope,
      },
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }): Promise<AIStatsFeedResponse> =>
      apiJson<AIStatsFeedResponse>(urlFor(pageParam), { signal }),
    getNextPageParam: (last) =>
      last.pagination.hasMore
        ? last.pagination.offset + last.pagination.limit
        : undefined,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const pages = query.data?.pages ?? [];
  return {
    ...query,
    /** Every row fetched so far, oldest request first. */
    items: pages.flatMap((page) => page.items),
    /** Rows matching the filter, from the first page (every page agrees). */
    totalCount: pages[0]?.pagination.totalCount ?? 0,
  };
};
