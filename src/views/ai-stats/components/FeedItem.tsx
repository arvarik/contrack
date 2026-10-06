/** One row of the AI usage activity feed. */
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
 * A label for every entry in AI_OPERATIONS (server/services/aiStatsService.ts).
 * Add one here for each new operation there, or the feed prints the raw key.
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
  aiSearchGrounding: "Web search",
  aiSearchNoSearch: "Web search, none ran",
  aiSearchExtraction: "Research extraction",
  aiSearchReading: "Research reading",
  aiSearchSinglePass: "Research (single pass)",
};

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();

  // Under a minute, or in the future from clock skew.
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
        // A contained row, not a ruled one: the app separates things by
        // surface. It is not a control, so it has no hover.
        "flex items-start gap-3 px-3 py-2.5 rounded-xl bg-surface-container-lowest",
      )}
    >
      <div className="mt-1.5 shrink-0">
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            item.cached ? "bg-success" : "bg-info",
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-on-surface">{opLabel}</span>

          {item.cached ? (
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-success/10 text-success ring-1 ring-success/20">
              Reused
            </span>
          ) : item.model ? (
            <span className="text-[11px] font-mono text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">
              {item.model
                .replace("gemini-", "")
                .replace("gpt-", "")
                .replace("claude-", "")
                .replace("-preview", " preview")}
            </span>
          ) : null}

          <span className="text-[11px] text-on-surface-variant ml-auto shrink-0 tabular-nums">
            {!item.cached && item.tokenCount
              ? `${formatTokens(item.tokenCount)} tokens · `
              : ""}
            {item.latencyMs > 0 ? `${item.latencyMs}ms` : "<1ms"}
          </span>
        </div>

        {item.description && (
          <p className="text-xs text-on-surface-variant mt-0.5 truncate">
            {item.description}
          </p>
        )}
      </div>

      <span className="text-[11px] text-on-surface-variant shrink-0 mt-0.5 tabular-nums">
        {formatRelativeTime(item.createdAt)}
      </span>
    </motion.div>
  );
};
