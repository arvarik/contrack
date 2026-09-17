/**
 * HistoryEntryRow — one question in the search history pane.
 *
 * Each row is a full-width button that re-runs the question on click.
 * Hover and focus reveal Pin and Delete icon buttons with 44px hit areas.
 *
 * @module views/search/HistoryEntryRow
 */

import React from "react";
import { FileText, Pin, PinOff, Search, Sparkles, Trash2 } from "lucide-react";
import type { HistoryEntry } from "../../../shared/searchHistory";
import { IconButton } from "../../components/ui/IconButton";
import { formatRelative } from "../../lib/datetime";
import { cn } from "../../lib/utils";

export interface HistoryEntryRowProps {
  entry: HistoryEntry;
  isCurrent: boolean;
  onSelect: (entry: HistoryEntry) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}

export const HistoryEntryRow = ({
  entry,
  isCurrent,
  onSelect,
  onTogglePin,
  onDelete,
}: HistoryEntryRowProps) => {
  const Icon =
    entry.mode === "notes"
      ? FileText
      : entry.mode === "palette"
        ? Search
        : Sparkles;

  const renderMeta = () => {
    const parts: string[] = [];
    if (entry.fallback) {
      parts.push("keyword fallback");
    } else if (entry.resultCount === 0) {
      parts.push("no matches");
    } else if (entry.resultCount !== null && entry.resultCount !== undefined) {
      const noun =
        entry.mode === "notes"
          ? entry.resultCount === 1
            ? "note"
            : "notes"
          : entry.resultCount === 1
            ? "person"
            : "people";
      parts.push(`${entry.resultCount} ${noun}`);
    }

    const relTime = formatRelative(entry.lastRunAt);
    if (relTime) {
      parts.push(relTime);
    }

    let meta = parts.join(" · ");
    if (entry.runCount > 1) {
      meta += ` · ×${entry.runCount}`;
    }
    return meta;
  };

  return (
    <div
      className={cn(
        "group relative flex items-center justify-between rounded-xl transition-colors",
        isCurrent
          ? "bg-primary/10"
          : "hover:bg-surface-container-high focus-within:bg-surface-container-high",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(entry)}
        aria-label={`Run again: ${entry.query}`}
        aria-current={isCurrent ? "true" : undefined}
        className="w-full text-left p-2.5 pr-24 flex items-start gap-2.5 rounded-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <div className="p-1 rounded-lg bg-surface-container-highest shrink-0 mt-0.5">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-on-surface line-clamp-2 break-words leading-snug">
            {entry.query}
          </div>
          <div className="text-xs text-on-surface-variant mt-0.5">
            {renderMeta()}
          </div>
        </div>
      </button>

      {/* Pin and Delete actions (44px hit-box icon buttons) */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <IconButton
          aria-label={entry.pinned ? "Unpin question" : "Pin question"}
          size="sm"
          tone="subtle"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(entry.id, !entry.pinned);
          }}
        >
          {entry.pinned ? (
            <PinOff className="w-4 h-4 text-primary" />
          ) : (
            <Pin className="w-4 h-4" />
          )}
        </IconButton>

        <IconButton
          aria-label="Delete question"
          size="sm"
          tone="danger"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.id);
          }}
        >
          <Trash2 className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  );
};
