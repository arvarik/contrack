/**
 * One question in the search history pane: a full-width button that runs it
 * again. Pin and Delete sit at the end of the meta line, so they never cover
 * the question.
 */

import React from "react";
import { FileText, Pin, PinOff, Search, Sparkles, Trash2 } from "lucide-react";
import type { HistoryEntry } from "../../../shared/searchHistory";
import { formatRelative } from "../../lib/datetime";
import { ICON_BTN, SELECTED_ROW } from "../../lib/styles";
import { cn } from "../../lib/utils";

interface HistoryEntryRowProps {
  entry: HistoryEntry;
  isCurrent: boolean;
  onSelect: (entry: HistoryEntry) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}

export const HistoryEntryRow = React.memo(
  ({
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
        // AI was off, failed or timed out, and the local list answered.
        parts.push("not verified by AI");
      } else if (entry.resultCount === 0) {
        parts.push("no matches");
      } else if (
        entry.resultCount !== null &&
        entry.resultCount !== undefined
      ) {
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
      // The hover layer is on the whole row, so it holds over Pin or Delete.
      <div
        className={cn(
          "state-layer group relative flex items-center justify-between rounded-xl transition-colors",
          isCurrent && SELECTED_ROW,
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(entry)}
          aria-label={`Run again: ${entry.query}`}
          aria-current={isCurrent ? "true" : undefined}
          className="w-full text-left p-2.5 flex items-start gap-2.5 rounded-xl cursor-pointer"
        >
          <div className="p-1 rounded-lg bg-surface-container-highest shrink-0 mt-0.5">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            {/* A second cue for the selected row, beside the tint. */}
            <div
              className={cn(
                "text-sm font-medium line-clamp-2 break-words leading-snug",
                isCurrent ? "text-on-primary-wash" : "text-on-surface",
              )}
            >
              {entry.query}
            </div>
            <div className="text-xs text-on-surface-variant mt-0.5 pr-14 truncate">
              {renderMeta()}
            </div>
          </div>
        </button>

        {/* With a fine pointer they show on hover or focus, and take no
            pointer events while hidden, so an invisible Delete takes no
            taps. A touch screen has no hover, so there they always show. */}
        <div className="absolute right-2 bottom-1.5 flex items-center gap-0.5 transition-opacity pointer-fine:opacity-0 pointer-fine:pointer-events-none pointer-fine:group-hover:opacity-100 pointer-fine:group-hover:pointer-events-auto pointer-fine:group-focus-within:opacity-100 pointer-fine:group-focus-within:pointer-events-auto">
          <button
            type="button"
            aria-label={entry.pinned ? "Unpin question" : "Pin question"}
            title={entry.pinned ? "Unpin" : "Pin"}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(entry.id, !entry.pinned);
            }}
            className={cn(ICON_BTN, "p-1 rounded-md")}
          >
            {entry.pinned ? (
              <PinOff className="w-4 h-4 text-primary" aria-hidden="true" />
            ) : (
              <Pin className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="Delete question"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry.id);
            }}
            className={cn(ICON_BTN, "p-1 rounded-md hover:text-error")}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  },
);

HistoryEntryRow.displayName = "HistoryEntryRow";
