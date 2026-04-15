/**
 * AIStatsView — Main page component for /settings/ai-stats.
 *
 * Three-zone layout:
 * 1. Summary Bar + KPI row (from useAIStatsSummary)
 * 2. Activity Feed with filters (from useAIStatsFeed)
 * 3. Cache Tiers accordion (from summary data)
 */
import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Activity, Coins, Gauge, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CARD, SECTION_HEADING } from '../../lib/styles';
import { MetricCard } from '../dashboard/MetricCard';
import { useAIStatsSummary, useAIStatsFeed } from '../../api';
import type { FeedQueryParams } from '../../api';
import { SummaryBar } from './components/SummaryBar';
import { AIStatsSkeleton } from './components/AIStatsSkeleton';
import { FeedFilters } from './components/FeedFilters';
import { FeedItem } from './components/FeedItem';
import { CacheTiersAccordion } from './components/CacheTiersAccordion';

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

const FEED_PAGE_SIZE = 50;

export const AIStatsView = () => {
  // ── Summary data ──────────────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading } = useAIStatsSummary();

  // ── Feed state ────────────────────────────────────────────────────────
  const [cacheFilter, setCacheFilter] = useState<'all' | 'fresh' | 'cached'>('all');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [offset, setOffset] = useState(0);

  const feedParams: FeedQueryParams = {
    offset,
    limit: FEED_PAGE_SIZE,
    sort,
    ...(cacheFilter === 'fresh' ? { cached: 'false' as const } : {}),
    ...(cacheFilter === 'cached' ? { cached: 'true' as const } : {}),
  };

  const { data: feed, isLoading: feedLoading, isFetching: feedFetching } = useAIStatsFeed(feedParams);

  // Reset offset when filters change
  const handleCacheFilterChange = useCallback((f: 'all' | 'fresh' | 'cached') => {
    setCacheFilter(f);
    setOffset(0);
  }, []);

  const handleSortChange = useCallback((s: 'newest' | 'oldest') => {
    setSort(s);
    setOffset(0);
  }, []);

  // ── Loading state ─────────────────────────────────────────────────────
  if (summaryLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto pb-20">
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
  const invocationSub = invocations > 0
    ? `${session!.freshCalls} fresh · ${session!.cachedCalls} cached`
    : undefined;

  // Sub-value for the tokens card
  const tokenSub = tier === 'PAID' && session && session.estimatedCostUsd > 0
    ? `~$${session.estimatedCostUsd.toFixed(4)}`
    : tier === 'FREE' && summary?.quota?.grounding
      ? `${summary.quota.grounding.remaining} grounding RPD left`
      : undefined;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 pb-20">
      {/* Zone 1: Summary Bar */}
      <SummaryBar summary={summary} isLoading={summaryLoading} />

      {/* Zone 1b: KPI Row */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="Invocations"
          value={formatCompact(invocations)}
          subValue={invocationSub}
          icon={Activity}
          delay={0.1}
        />
        <MetricCard
          label="Tokens Used"
          value={formatCompact(tokens)}
          subValue={tokenSub}
          icon={Coins}
          delay={0.15}
        />
        <MetricCard
          label="Cache Hit Rate"
          value={invocations > 0 ? `${(cacheHitRate * 100).toFixed(0)}%` : '—'}
          subValue={invocations > 0 ? `${session!.cachedCalls} hits` : undefined}
          icon={Gauge}
          delay={0.2}
          highlight={cacheHitRate >= 0.5}
        />
      </div>

      {/* Zone 2: Activity Feed */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25, ease: 'easeOut' }}
        className={cn(CARD, 'space-y-3')}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={cn(SECTION_HEADING, 'mb-0')}>Activity Feed</span>
          {feedFetching && !feedLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-primary/50" />
          )}
          {feed && (
            <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container px-1.5 py-0.5 rounded-full tabular-nums">
              {feed.pagination.totalCount}
            </span>
          )}
        </div>

        <FeedFilters
          cacheFilter={cacheFilter}
          onCacheFilterChange={handleCacheFilterChange}
          sort={sort}
          onSortChange={handleSortChange}
        />

        {/* Feed items */}
        <div className="divide-y divide-outline-variant/10">
          {feedLoading ? (
            <div className="py-8 text-center text-sm text-on-surface-variant/50">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary/40" />
              Loading activity...
            </div>
          ) : feed && feed.items.length > 0 ? (
            <>
              {feed.items.map((item, i) => (
                <FeedItem key={item.id} item={item} index={i} />
              ))}

              {/* Pagination */}
              {feed.pagination.hasMore && (
                <div className="pt-3 flex justify-center">
                  <button
                    onClick={() => setOffset(offset + FEED_PAGE_SIZE)}
                    disabled={feedFetching}
                    className={cn(
                      'px-4 py-2 rounded-full text-xs font-bold transition-all',
                      'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
                      'disabled:opacity-50'
                    )}
                  >
                    {feedFetching ? 'Loading...' : 'Load older activity'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="py-10 text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 text-on-surface-variant/20" />
              <p className="text-sm text-on-surface-variant/50">No AI activity recorded yet.</p>
              <p className="text-xs text-on-surface-variant/30 mt-1">
                Trigger a Catch-Me-Up briefing or AI Search to see invocations here.
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Zone 3: Cache Tiers */}
      {summary?.cacheTiers && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3, ease: 'easeOut' }}
        >
          <CacheTiersAccordion cacheTiers={summary.cacheTiers} />
        </motion.div>
      )}
    </div>
  );
};
