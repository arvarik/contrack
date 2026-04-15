/**
 * FeedItem — Single row in the AI Stats activity feed.
 * Shows a cache dot, operation name, model badge, token/latency stats,
 * description, and relative timestamp.
 */
import React from 'react';
import { cn } from '../../../lib/utils';
import { motion } from 'motion/react';
import type { AIStatsFeedItem } from '../../../api';

interface FeedItemProps {
  item: AIStatsFeedItem;
  index: number;
}

/** Human-readable labels for operation codes. */
const OP_LABELS: Record<string, string> = {
  briefing: 'Briefing',
  rerank: 'Rerank',
  mentions: 'Mentions',
  synthesis: 'Synthesis',
  parse: 'Parse',
  searchExpansion: 'Search Expansion',
  dailyInsight: 'Daily Insight',
  emlSummary: 'EML Summary',
  bulkParse: 'Bulk Parse',
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatTokens(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const FeedItem = ({ item, index }: FeedItemProps) => {
  const opLabel = OP_LABELS[item.operation] ?? item.operation;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: 'easeOut' }}
      className={cn(
        'flex items-start gap-3 py-2.5 px-1 -mx-1 rounded-lg transition-colors',
        'hover:bg-surface-container-low/50'
      )}
    >
      {/* Cache dot */}
      <div className="mt-1.5 shrink-0">
        <div className={cn(
          'w-2 h-2 rounded-full',
          item.cached
            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]'
            : 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.4)]'
        )} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-on-surface">{opLabel}</span>

          {/* Model badge or CACHED pill */}
          {item.cached ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
              Cached
            </span>
          ) : item.model ? (
            <span className="text-[10px] font-mono text-on-surface-variant/60 bg-surface-container px-1.5 py-0.5 rounded">
              {item.model.replace('gemini-', '').replace('-preview', ' ⌘')}
            </span>
          ) : null}

          {/* Token + latency stats */}
          <span className="text-[10px] text-on-surface-variant/50 ml-auto shrink-0 tabular-nums">
            {!item.cached && item.tokenCount ? `${formatTokens(item.tokenCount)} tok · ` : ''}
            {item.latencyMs > 0 ? `${item.latencyMs}ms` : '<1ms'}
          </span>
        </div>

        {/* Description */}
        {item.description && (
          <p className="text-xs text-on-surface-variant/70 mt-0.5 truncate">
            {item.description}
          </p>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-[10px] text-on-surface-variant/40 shrink-0 mt-0.5 tabular-nums">
        {formatRelativeTime(item.createdAt)}
      </span>
    </motion.div>
  );
};
