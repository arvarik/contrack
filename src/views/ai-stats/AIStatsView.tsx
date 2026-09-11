/**
 * AIStatsView — Main page component for /settings/ai-stats.
 *
 * Three-zone layout:
 * 1. Summary Bar + KPI row (from useAIStatsSummary)
 * 2. Activity Feed with filters (from useAIStatsFeed)
 * 3. Cache Tiers accordion (from summary data)
 */
import React, { useState, useCallback } from "react";
import { Activity, Coins, Gauge, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { tileDelay } from "../../lib/motion";
import { CARD, SECTION_HEADING } from "../../lib/styles";
import { MetricCard } from "../dashboard/MetricCard";
import { FEED_PAGE_SIZE, useAIStatsSummary, useAIStatsFeed } from "../../api";
import type { FeedQueryParams } from "../../api";
import { SummaryBar } from "./components/SummaryBar";
import { AIStatsSkeleton } from "./components/AIStatsSkeleton";
import { FeedFilters } from "./components/FeedFilters";
import { FeedItem } from "./components/FeedItem";
import { CacheTiersAccordion } from "./components/CacheTiersAccordion";
import { InstanceUsageTable } from "./components/InstanceUsageTable";
import { Segmented } from "../../components/ui/Segmented";
import { useAuth } from "../../components/auth/AuthGate";

// =============================================================================
// Number formatting
// =============================================================================

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// =============================================================================
// Component
// =============================================================================

export const AIStatsView = () => {
  const { isAdmin } = useAuth();
  /*
   * Whose spending is on screen.
   *
   * The provider key is one key and the bill is one bill, so an operator
   * needs the instance view; everybody else's own page is the default,
   * including an admin's, because an admin is also somebody with contacts.
   * `scope=all` is never sent speculatively: a member asking for it gets a
   * 403 the shared client turns into a toast on their screen.
   */
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const instanceScope =
    isAdmin && scope === "all" ? ("all" as const) : undefined;

  // ── Summary data ──────────────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading } =
    useAIStatsSummary(instanceScope);

  // ── Feed state ────────────────────────────────────────────────────────
  const [cacheFilter, setCacheFilter] = useState<"all" | "fresh" | "cached">(
    "all",
  );
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const feedParams: FeedQueryParams = {
    limit: FEED_PAGE_SIZE,
    sort,
    ...(cacheFilter === "fresh" ? { cached: "false" as const } : {}),
    ...(cacheFilter === "cached" ? { cached: "true" as const } : {}),
    ...(instanceScope ? { scope: instanceScope } : {}),
  };

  const {
    items: feedItems,
    totalCount,
    isLoading: feedLoading,
    isFetching: feedFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useAIStatsFeed(feedParams);

  // No offset to reset. The filters are part of the query key, so changing
  // one starts a new query whose first page is the only page, and the
  // previous list stays on screen until it lands.
  const handleCacheFilterChange = useCallback(
    (f: "all" | "fresh" | "cached") => setCacheFilter(f),
    [],
  );

  const handleSortChange = useCallback(
    (s: "newest" | "oldest") => setSort(s),
    [],
  );

  /**
   * The scope control, and only for an admin.
   *
   * Rendered by both branches below, including the loading one. Switching
   * scope is a cache miss, so it turns `summaryLoading` back on — and when
   * the early return sat above this, pressing "All users" unmounted the
   * control that had just been pressed. Focus went to `<body>` and there was
   * no way back to "Mine" until the request landed.
   */
  const scopeControl = isAdmin ? (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-on-surface-variant text-pretty">
        {scope === "all"
          ? "Every account on this instance. One provider key pays for all of it."
          : "Your own AI use."}
      </p>
      <Segmented
        label="Whose AI usage"
        value={scope}
        onChange={(next) => setScope(next)}
        options={[
          { value: "mine", label: "Mine" },
          { value: "all", label: "All users" },
        ]}
      />
    </div>
  ) : null;

  // ── Loading state ─────────────────────────────────────────────────────
  if (summaryLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 pb-20">
        {scopeControl}
        <AIStatsSkeleton />
      </div>
    );
  }

  // ── Derived KPIs ──────────────────────────────────────────────────────
  const session = summary?.session;
  const invocations = session?.totalInvocations ?? 0;
  const tokens = session?.totalTokens ?? 0;
  const cacheHitRate = session?.cacheHitRate ?? 0;
  const tier = summary?.tier;

  // Sub-value for the invocations card
  const invocationSub =
    invocations > 0
      ? `${session!.freshCalls} fresh · ${session!.cachedCalls} cached`
      : undefined;

  // Sub-value for the tokens card
  // Cost displays for any paid provider (PAID, OPENAI, ANTHROPIC — anything not FREE/MOCK)
  const isPaidProvider =
    tier !== undefined && tier !== "FREE" && tier !== "MOCK";
  const tokenSub =
    isPaidProvider && session && session.estimatedCostUsd > 0
      ? `~$${session.estimatedCostUsd.toFixed(4)}`
      : tier === "FREE" && summary?.quota?.grounding
        ? `${summary.quota.grounding.remaining} grounding RPD left`
        : undefined;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 pb-20">
      {scopeControl}

      {/* Zone 1: Summary Bar */}
      <SummaryBar summary={summary} isLoading={summaryLoading} />

      {/* Zone 1b: KPI Row — stacked on phones, 3 up from sm */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="Invocations"
          value={formatCompact(invocations)}
          subValue={invocationSub}
          icon={Activity}
          delay={tileDelay(0)}
        />
        <MetricCard
          label="Tokens Used"
          value={formatCompact(tokens)}
          subValue={tokenSub}
          icon={Coins}
          delay={tileDelay(1)}
        />
        <MetricCard
          label="Cache Hit Rate"
          value={invocations > 0 ? `${(cacheHitRate * 100).toFixed(0)}%` : "—"}
          subValue={
            invocations > 0 ? `${session!.cachedCalls} hits` : undefined
          }
          icon={Gauge}
          delay={tileDelay(2)}
          highlight={cacheHitRate >= 0.5}
        />
      </div>

      {/* Zone 1c: who spent it — instance scope only */}
      {summary?.byUser && (
        <div
          style={{ animationDelay: tileDelay(3) }}
          className={cn(CARD, "tile-enter space-y-3")}
        >
          <span className={cn(SECTION_HEADING, "mb-0")}>By account</span>
          <InstanceUsageTable
            byUser={summary.byUser}
            showCost={isPaidProvider}
          />
        </div>
      )}

      {/* Zone 2: Activity Feed */}
      <div
        style={{ animationDelay: tileDelay(3) }}
        className={cn(CARD, "tile-enter space-y-3")}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={cn(SECTION_HEADING, "mb-0")}>Activity Feed</span>
          {feedFetching && !feedLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
          )}
          {!feedLoading && (
            <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-full tabular-nums">
              {feedItems.length < totalCount
                ? `${feedItems.length} of ${totalCount}`
                : totalCount}
            </span>
          )}
        </div>

        <FeedFilters
          cacheFilter={cacheFilter}
          onCacheFilterChange={handleCacheFilterChange}
          sort={sort}
          onSortChange={handleSortChange}
        />

        {/*
          Feed items — separated by spacing and a surface shift rather than
          rules. Each entry is a small card, matching the merge activity feed
          in Settings → Duplicates, so the two audit logs in this app read as
          the same kind of object.
        */}
        <div className="space-y-1.5">
          {feedLoading ? (
            <div className="py-8 text-center text-sm text-on-surface-variant">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
              Loading activity...
            </div>
          ) : feedItems.length > 0 ? (
            <>
              {feedItems.map((item, i) => (
                <FeedItem key={item.id} item={item} index={i} />
              ))}

              {/*
                Appends. Pressing this used to raise an offset and replace
                everything above it with the next twenty rows, so reading the
                feed meant losing what you had just read and there was no way
                back. Known issue B-02.
              */}
              {hasNextPage && (
                <div className="pt-3 flex justify-center">
                  <button
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className={cn(
                      "px-4 py-2 rounded-full text-xs font-bold transition-all",
                      "bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high",
                      "disabled:opacity-50",
                    )}
                  >
                    {isFetchingNextPage ? "Loading..." : "Load older activity"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="py-10 text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 text-on-surface-variant/20" />
              <p className="text-sm text-on-surface-variant">
                No AI activity recorded yet.
              </p>
              {/*
                Was `text-on-surface-variant/30`, which measures 1.57:1 and
                is the only text in the app the contrast audit fails on. It
                predates this phase; the audit gates the phase, and an empty
                state nobody can read is not an empty state.
              */}
              <p className="text-xs text-on-surface-variant mt-1">
                Trigger a Catch-Me-Up briefing or AI Search to see invocations
                here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Zone 3: Cache Tiers */}
      {summary?.cacheTiers && (
        <div className="tile-enter" style={{ animationDelay: tileDelay(4) }}>
          <CacheTiersAccordion cacheTiers={summary.cacheTiers} />
        </div>
      )}
    </div>
  );
};
