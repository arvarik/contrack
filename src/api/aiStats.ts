import { apiJson } from "./client";
/**
 * AI Stats API hooks — React Query hooks for the AI Stats Page.
 *
 * Two hooks matching the backend API contracts (ARCHITECTURE.md §11):
 * - useAIStatsSummary()  → GET /api/ai/stats/summary
 * - useAIStatsFeed()     → GET /api/ai/stats/feed
 */
import {
  useInfiniteQuery,
  useQuery,
  keepPreviousData,
} from "@tanstack/react-query";

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
 * How many rows one page of the feed holds.
 *
 * Here rather than in the view, because this is the module that pages. Two
 * constants of the same name in two files, one of them a fallback the other
 * always overrode, is how a page size ends up being 20 in one code path and
 * 50 in another with nobody able to say which is the real one.
 */
export const FEED_PAGE_SIZE = 50;

/**
 * The AI invocation feed, one page at a time, appended.
 *
 * "Load older activity" used to raise an offset on a plain query, which
 * **replaced** what was on screen with the next twenty rows. Reading a feed
 * meant losing the rows you had just read, and going back meant a button that
 * did not exist. It was carried in `.agent/STATUS.md` as known issue B-02,
 * and the blocker was the design decision rather than the code.
 *
 * The decision is append. A feed is a list of things that happened, read
 * downward, and the thing somebody is doing with it is scanning for the entry
 * that explains a cost — which is a search, not a lookup at a known page
 * number. Numbered pages would be the right answer for a list you return to
 * at a remembered position, and nobody remembers a position in a log.
 *
 * The offset is the cursor and is kept by the query rather than by the view,
 * so a filter change starts a new query and the list resets by itself. The
 * previous list stays on screen while the new one loads.
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
    // The offset is deliberately NOT in the key. It is the cursor inside this
    // query, and a key that moved with it would make every page a separate
    // cache entry and defeat the whole thing.
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
    /**
     * How many rows match the filter in total.
     *
     * From the first page. Every page reports the same number, and the first
     * is the one that exists as soon as anything does.
     */
    totalCount: pages[0]?.pagination.totalCount ?? 0,
  };
};
