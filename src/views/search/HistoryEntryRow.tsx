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
import { SELECTED_ROW } from "../../lib/styles";
import { cn } from "../../lib/utils";

export interface HistoryEntryRowProps {
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
        // The semantic index could not answer, so the words were matched.
        parts.push("keyword search");
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
      // The hover layer sits on the whole row, so it holds while the pointer
      // is over Pin or Delete. The question the page is showing is the
      // selected row.
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
          // The text takes the row's width. Only a touch screen, where Pin
          // and Delete always show, keeps room for them.
          className="w-full text-left p-2.5 [@media(hover:none)]:pr-20 flex items-start gap-2.5 rounded-xl cursor-pointer"
        >
          <div className="p-1 rounded-lg bg-surface-container-highest shrink-0 mt-0.5">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            {/* The current question's words take the primary ink, the
                selected row's second cue beside the tint. */}
            <div
              className={cn(
                "text-sm font-medium line-clamp-2 break-words leading-snug",
                isCurrent ? "text-on-primary-wash" : "text-on-surface",
              )}
            >
              {entry.query}
            </div>
            <div className="text-xs text-on-surface-variant mt-0.5">
              {renderMeta()}
            </div>
          </div>
        </button>

        {/* Pin and Delete (44 px tap boxes). With a pointer they float over
            the row's right edge on a card-face pill while the row is hovered
            or holds focus, and take no pointer events while hidden: an
            invisible Delete took the taps at a row's end. A touch screen
            has no hover, so there they always show, in room the row keeps. */}
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-lg p-0.5 bg-surface-container-lowest shadow-sm transition-opacity opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:bg-transparent [@media(hover:none)]:shadow-none">
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
  },
);

HistoryEntryRow.displayName = "HistoryEntryRow";
