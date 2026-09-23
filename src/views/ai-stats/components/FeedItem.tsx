/**
 * FeedItem — Single row in the AI Stats activity feed.
 * Shows a cache dot, operation name, model badge, token/latency stats,
 * description, and relative timestamp.
 */
import React from "react";
import { cn } from "../../../lib/utils";
import { motion } from "motion/react";
import type { AIStatsFeedItem } from "../../../api";
import { formatDay } from "../../../lib/datetime";
import { DURATION, EASE } from "../../../lib/motion";

interface FeedItemProps {
  key?: React.Key;
  item: AIStatsFeedItem;
  index: number;
}

/**
 * Human-readable labels for operation codes.
 *
 * Covers every entry in AI_OPERATIONS (server/services/aiStatsService.ts).
 * Five were missing, so the feed printed raw keys such as "queryParse" and
 * "aiSearchGrounding" next to properly named rows. Add a label here whenever
 * you add an operation there.
 */
const OP_LABELS: Record<string, string> = {
  briefing: "Briefing",
  rerank: "Rerank",
  mentions: "Mentions",
  synthesis: "Synthesis",
  parse: "Parse",
  searchExpansion: "Search expansion",
  dailyInsight: "Daily insight",
  emlSummary: "Email summary",
  connectorSummary: "Connector summary",
  bulkParse: "Bulk parse",
  queryParse: "Query parse",
  hyde: "Query expansion",
  aiSearchGrounding: "Web research",
  aiSearchExtraction: "Research extraction",
  aiSearchSinglePass: "Research (single pass)",
};

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();

  // Handle clock skew or very recent items
  if (diffMs < 60000) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDay(iso);
}

function formatTokens(n: number | null): string {
  if (n === null || n === undefined) return "—";
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
      transition={{ duration: DURATION.slow, delay: index * 0.03, ease: EASE }}
      className={cn(
        // A contained row rather than a ruled one: the bottom-only border read
        // as an unfinished table, and the app separates things by surface
        // elsewhere (see the sidebar utility group). A row that is not a
        // control, so it has no hover.
        "flex items-start gap-3 px-3 py-2.5 rounded-xl bg-surface-container-lowest",
      )}
    >
      {/* Cache dot */}
      <div className="mt-1.5 shrink-0">
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            item.cached ? "bg-success" : "bg-info",
          )}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-on-surface">{opLabel}</span>

          {/* Model badge or CACHED pill */}
          {item.cached ? (
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-success/10 text-success ring-1 ring-success/20">
              Cached
            </span>
          ) : item.model ? (
            <span className="text-[11px] font-mono text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">
              {item.model
                .replace("gemini-", "")
                .replace("gpt-", "")
                .replace("claude-", "")
                .replace("-preview", " ⌘")}
            </span>
          ) : null}

          {/* Token + latency stats */}
          <span className="text-[11px] text-on-surface-variant ml-auto shrink-0 tabular-nums">
            {!item.cached && item.tokenCount
              ? `${formatTokens(item.tokenCount)} tok · `
              : ""}
            {item.latencyMs > 0 ? `${item.latencyMs}ms` : "<1ms"}
          </span>
        </div>

        {/* Description */}
        {item.description && (
          <p className="text-xs text-on-surface-variant mt-0.5 truncate">
            {item.description}
          </p>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-[11px] text-on-surface-variant shrink-0 mt-0.5 tabular-nums">
        {formatRelativeTime(item.createdAt)}
      </span>
    </motion.div>
  );
};
