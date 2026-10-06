/** The AI usage page: summary, KPI tiles, activity feed and cache tiers. */
import { useState, useCallback } from "react";
import { Activity, Coins, Gauge, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { tileDelay } from "../../lib/motion";
import { CARD, SECTION_HEADING } from "../../lib/styles";
import { SETTINGS_PAGE } from "../settings/layout";
import { MetricCard } from "../pulse/MetricCard";
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
import { EmptyState } from "../../components/ui/EmptyState";

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const AIStatsView = () => {
  const { isAdmin } = useAuth();
  // Whose spending shows. Each person's own is the default, an admin's too.
  // `scope=all` is never sent speculatively: a member gets a 403, and the
  // shared client shows it as a toast.
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const instanceScope =
    isAdmin && scope === "all" ? ("all" as const) : undefined;

  const { data: summary, isLoading: summaryLoading } =
    useAIStatsSummary(instanceScope);

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

  // The filters are in the query key, so a change starts a new query. The
  // old list stays on screen until the new one lands.
  const handleCacheFilterChange = useCallback(
    (f: "all" | "fresh" | "cached") => setCacheFilter(f),
    [],
  );

  const handleSortChange = useCallback(
    (s: "newest" | "oldest") => setSort(s),
    [],
  );

  // Admins only. Both branches below render it, the loading one too: a scope
  // switch turns `summaryLoading` on, and an unmounted control drops focus
  // to `<body>`.
  const scopeControl = isAdmin ? (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-on-surface-variant text-pretty">
        {scope === "all"
          ? "Every account on this instance. One provider key pays for all of it"
          : "Your own AI use"}
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

  if (summaryLoading) {
    return (
      <div className={cn(SETTINGS_PAGE, "space-y-4")}>
        {scopeControl}
        <AIStatsSkeleton />
      </div>
    );
  }

  const session = summary?.session;
  const invocations = session?.totalInvocations ?? 0;
  const tokens = session?.totalTokens ?? 0;
  const cacheHitRate = session?.cacheHitRate ?? 0;
  const tier = summary?.tier;

  const invocationSub =
    invocations > 0
      ? `${session!.freshCalls} new · ${session!.cachedCalls} reused`
      : undefined;

  // The cost is an estimate at list prices, so it shows nothing for a Gemini
  // free-tier key, which Google does not bill.
  const showCost = tier === "LIVE" && !summary?.freeTier;
  const tokenSub =
    showCost && session && session.estimatedCostUsd > 0
      ? `~$${session.estimatedCostUsd.toFixed(4)}`
      : undefined;

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-4")}>
      {scopeControl}

      <SummaryBar summary={summary} isLoading={summaryLoading} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="AI calls"
          value={formatCompact(invocations)}
          subValue={invocationSub}
          icon={Activity}
          delay={tileDelay(0)}
        />
        <MetricCard
          label="Tokens used"
          value={formatCompact(tokens)}
          subValue={tokenSub}
          icon={Coins}
          delay={tileDelay(1)}
        />
        <MetricCard
          label="Reused answers"
          value={invocations > 0 ? `${(cacheHitRate * 100).toFixed(0)}%` : "—"}
          subValue={
            invocations > 0
              ? `${session!.cachedCalls} of ${invocations} calls`
              : undefined
          }
          icon={Gauge}
          delay={tileDelay(2)}
          highlight={cacheHitRate >= 0.5}
        />
      </div>

      {summary?.byUser && (
        <div
          style={{ animationDelay: tileDelay(3) }}
          className={cn(CARD, "tile-enter space-y-3")}
        >
          <span className={cn(SECTION_HEADING, "mb-0")}>By account</span>
          <InstanceUsageTable byUser={summary.byUser} showCost={showCost} />
        </div>
      )}

      <div
        style={{ animationDelay: tileDelay(3) }}
        className={cn(CARD, "tile-enter space-y-3")}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={cn(SECTION_HEADING, "mb-0")}>Activity feed</span>
          {feedFetching && !feedLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
          )}
          {!feedLoading && (
            <span className="text-[11px] font-bold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-md tabular-nums">
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

        {/* Small cards, like the merge feed in Settings → Duplicates, so the
            two audit logs read alike. */}
        <div className="space-y-1.5">
          {feedLoading ? (
            <div className="py-8 text-center text-sm text-on-surface-variant">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
              Loading activity…
            </div>
          ) : feedItems.length > 0 ? (
            <>
              {feedItems.map((item, i) => (
                <FeedItem key={item.id} item={item} index={i} />
              ))}

              {/* Appends, so the rows already read stay above. */}
              {hasNextPage && (
                <div className="pt-3 flex justify-center">
                  <button
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="btn-secondary"
                  >
                    {isFetchingNextPage ? "Loading…" : "Load older activity"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={Activity}
              title="No AI activity yet"
              body="Briefings, searches and scans show up here"
            />
          )}
        </div>
      </div>

      {summary?.cacheTiers && (
        <div className="tile-enter" style={{ animationDelay: tileDelay(4) }}>
          <CacheTiersAccordion cacheTiers={summary.cacheTiers} />
        </div>
      )}
    </div>
  );
};
