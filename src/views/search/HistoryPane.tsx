/**
 * HistoryPane — the history side-pane and mobile sheet for Ask Contrack.
 *
 * Displays previous questions grouped by day and month, with instant filtering,
 * mode filtering, pinning, deletion with undo, and one-click re-running.
 *
 * @module views/search/HistoryPane
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { PanelRightClose, Search, SearchX, Sparkles, X } from "lucide-react";
import type { HistoryEntry, HistoryMode } from "../../../shared/searchHistory";
import { normalizeQuery } from "../../../shared/searchHistory";
import {
  useClearHistory,
  useDeleteHistoryEntry,
  useSearchHistoryList,
  useSetPinned,
} from "../../api/searchHistory";
import { Badge } from "../../components/ui/Badge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Segmented, type SegmentedOption } from "../../components/ui/Segmented";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useDebounce } from "../../hooks/useDebounce";
import {
  startPendingDelete,
  useHiddenPendingIds,
} from "../../lib/pendingDeletes";
import { BTN_QUIET, ICON_BTN, SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { HistoryEntryRow } from "./HistoryEntryRow";
import { groupHistoryEntries } from "./historyGroups";

export interface HistoryPaneProps {
  currentQuery?: string;
  currentMode?: HistoryMode;
  onSelect: (entry: HistoryEntry) => void;
  /**
   * Closes the side pane. Given, the pane draws a "Hide history" button at
   * the right end of its header.
   */
  onHide?: () => void;
  /**
   * Closes the phone's sheet. Given, the pane draws an X named "Close
   * history" in the same place: the sheet has no close control of its own.
   */
  onClose?: () => void;
  /** The key that also hides the pane, named in the button's tooltip. */
  hideShortcut?: string;
  className?: string;
}

type ModeFilter = "all" | HistoryMode;

const MODE_OPTIONS: readonly SegmentedOption<ModeFilter>[] = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "notes", label: "Notes" },
];

export const HistoryPane = ({
  currentQuery,
  currentMode = "people",
  onSelect,
  onHide,
  onClose,
  hideShortcut,
  className,
}: HistoryPaneProps) => {
  const { preferences } = usePreferences();
  const [filterText, setFilterText] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [selectedMode, setSelectedMode] = useState<ModeFilter>("all");
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const debouncedFilter = useDebounce(filterText.trim(), 200);

  const queryFilters = useMemo(
    () => ({
      mode: selectedMode === "all" ? undefined : selectedMode,
      q: debouncedFilter || undefined,
    }),
    [selectedMode, debouncedFilter],
  );

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useSearchHistoryList(queryFilters);

  const setPinnedMutation = useSetPinned();
  const deleteMutation = useDeleteHistoryEntry();
  const clearMutation = useClearHistory();
  const hiddenIds = useHiddenPendingIds();

  const allEntries = useMemo(
    () =>
      data?.pages.flatMap((page) =>
        Array.isArray(page?.entries) ? page.entries : [],
      ) ?? [],
    [data],
  );

  const visibleEntries = useMemo(
    () => allEntries.filter((e) => e?.id && !hiddenIds.has(e.id)),
    [allEntries, hiddenIds],
  );

  const totalCount = Math.max(
    0,
    (typeof data?.pages[0]?.total === "number"
      ? data.pages[0].total
      : visibleEntries.length) - hiddenIds.size,
  );

  const groups = useMemo(
    () =>
      groupHistoryEntries(
        visibleEntries,
        new Date(),
        preferences.weekStart ?? "monday",
      ),
    [visibleEntries, preferences.weekStart],
  );

  const normalizedCurrent = currentQuery ? normalizeQuery(currentQuery) : "";

  const isCurrent = (entry: HistoryEntry) => {
    if (!normalizedCurrent) return false;
    return (
      entry.mode === currentMode && entry.normalizedQuery === normalizedCurrent
    );
  };

  const handleTogglePin = useCallback(
    (id: string, pinned: boolean) => {
      setPinnedMutation.mutate({ id, pinned });
    },
    [setPinnedMutation],
  );

  const handleDelete = useCallback(
    (id: string) => {
      startPendingDelete({
        id,
        message: "Question deleted",
        errorMessage: "Could not delete question.",
        flushUrl: `/search/history/${encodeURIComponent(id)}`,
        send: () => deleteMutation.mutateAsync(id),
      });
    },
    [deleteMutation],
  );

  const handleClear = () => {
    clearMutation.mutate(selectedMode === "all" ? undefined : selectedMode, {
      onSuccess: () => {
        setClearDialogOpen(false);
        filterInputRef.current?.focus();
      },
    });
  };

  const hasActiveFilter = Boolean(debouncedFilter || selectedMode !== "all");

  return (
    <div className={className ?? "flex flex-col h-full p-4 space-y-4"}>
      {/* 1. Title row. The pane closes from its own top corner, where a
          side panel's close control usually sits, and the page header's
          toggle opens it again. */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-on-surface">History</h2>
          <Badge tone="neutral">{totalCount}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {totalCount > 0 && !filterText.trim() && (
            <button
              type="button"
              onClick={() => setClearDialogOpen(true)}
              className={cn(BTN_QUIET, "hover:text-error cursor-pointer")}
            >
              Clear
            </button>
          )}
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              aria-label="Hide history"
              title={
                hideShortcut ? `Hide history (${hideShortcut})` : "Hide history"
              }
              className={cn(ICON_BTN, "-mr-2")}
            >
              <PanelRightClose className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close history"
              className={cn(ICON_BTN, "-mr-2")}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Filter & Segmented controls */}
      <div className="space-y-2 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-on-surface-variant absolute left-3 pointer-events-none" />
          <input
            ref={filterInputRef}
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter questions"
            aria-label="Filter history"
            className="w-full pl-9 pr-8 py-1.5 text-sm bg-surface-container-highest rounded-xl border-none text-on-surface placeholder:text-on-surface-variant"
          />
          {filterText.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilterText("");
                filterInputRef.current?.focus();
              }}
              aria-label="Clear filter text"
              className={cn(ICON_BTN, "absolute right-2 p-1 cursor-pointer")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <Segmented
          options={MODE_OPTIONS}
          value={selectedMode}
          onChange={setSelectedMode}
          label="Filter by mode"
          className="w-full"
        />
      </div>

      {/* 3. Groups & List */}
      <div className="flex-1 overflow-y-auto space-y-5 -mx-1 px-1">
        {groups.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <h3 id={`history-group-${group.key}`} className={SECTION_HEADING}>
              {group.label}
            </h3>
            <ul
              aria-labelledby={`history-group-${group.key}`}
              className="space-y-1"
            >
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <HistoryEntryRow
                    entry={entry}
                    isCurrent={isCurrent(entry)}
                    onSelect={onSelect}
                    onTogglePin={handleTogglePin}
                    onDelete={handleDelete}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Load more */}
        {hasNextPage && (
          <div className="pt-2 pb-4">
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="state-layer w-full py-2 text-xs font-semibold text-primary rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}

        {/* Empty States */}
        {!isLoading && visibleEntries.length === 0 && (
          <div className="py-8">
            {hasActiveFilter ? (
              <EmptyState
                icon={SearchX}
                title="No questions match"
                body="Try adjusting your filter or mode."
                level={3}
              />
            ) : (
              <EmptyState
                icon={Sparkles}
                title="Your questions will appear here"
                body="Questions you ask across People and Notes will be saved here."
                level={3}
              />
            )}
          </div>
        )}
      </div>

      {/* Confirm Clear Dialog */}
      <ConfirmDialog
        isOpen={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        onConfirm={handleClear}
        title="Clear search history"
        description={`Delete all ${totalCount} questions? This cannot be undone.`}
        confirmLabel="Delete all"
      />
    </div>
  );
};
