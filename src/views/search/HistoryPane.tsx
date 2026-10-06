/**
 * The questions asked on Ask Contrack. From `lg` the page's `SidePanel` draws
 * the heading row, so the pane hands its parts to `children`. Below `lg` the
 * sheet has no heading, so the pane draws one with an X that calls `onClose`.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Search, SearchX, Sparkles, X } from "lucide-react";
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
import { SIDE_PANEL_SCROLLER } from "../../components/layout/SidePanel";
import { cn } from "../../lib/utils";
import { HistoryEntryRow } from "./HistoryEntryRow";
import { groupHistoryEntries } from "./historyGroups";
import { NO_AUTOCORRECT } from "../../components/ui/SearchField";
import { ClearButton } from "../../components/ui/SearchField";

interface HistoryPaneParts {
  count: number;
  /** Clear, while there is something to clear and no words in the filter. */
  actions: React.ReactNode;
  body: React.ReactNode;
}

interface HistoryPaneProps {
  currentQuery?: string;
  currentMode?: HistoryMode;
  onSelect: (entry: HistoryEntry) => void;
  onClose?: () => void;
  /** For a frame with its own heading row. Given, the pane draws no heading. */
  children?: (parts: HistoryPaneParts) => React.ReactNode;
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
  onClose,
  children,
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
        errorMessage: "Could not delete question",
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

  const actions =
    totalCount > 0 && !filterText.trim() ? (
      <button
        type="button"
        onClick={() => setClearDialogOpen(true)}
        className={cn(BTN_QUIET, "hover:text-error cursor-pointer")}
      >
        Clear
      </button>
    ) : null;

  const body = (
    <div className="flex flex-col h-full gap-4">
      <div className="space-y-2 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-on-surface-variant absolute left-3 pointer-events-none" />
          <input
            ref={filterInputRef}
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            // Escape clears the words first. The side panel skips a used
            // key, so the next Escape hides the panel.
            onKeyDown={(e) => {
              if (e.key !== "Escape" || !filterText) return;
              e.preventDefault();
              setFilterText("");
            }}
            placeholder="Filter questions"
            aria-label="Filter history"
            {...NO_AUTOCORRECT}
            className="w-full pl-9 pr-8 py-1.5 text-sm bg-surface-container-highest rounded-xl border-none text-on-surface placeholder:text-on-surface-variant"
          />
          {filterText.length > 0 && (
            <ClearButton
              label="Clear filter text"
              onClick={() => {
                setFilterText("");
                filterInputRef.current?.focus();
              }}
            />
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

      {/* The scroller reaches the frame's side edges, and its inset keeps a
          row's focus ring inside it. */}
      <div className={cn(SIDE_PANEL_SCROLLER, "space-y-5")}>
        {groups.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <h3 id={`history-group-${group.key}`} className={SECTION_HEADING}>
              {group.label}
            </h3>
            <ul
              aria-labelledby={`history-group-${group.key}`}
              className="space-y-1"
            >
              {/* Keyed by the question, not the id: a new question has a
                  stand-in id until the server answers, and a key change
                  remounts the row. */}
              {group.entries.map((entry) => (
                <li key={`${entry.mode}:${entry.normalizedQuery}`}>
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

        {!isLoading && visibleEntries.length === 0 && (
          <div className="py-8">
            {hasActiveFilter ? (
              <EmptyState
                icon={SearchX}
                title="No questions match"
                body="Try adjusting your filter or mode"
                level={3}
              />
            ) : (
              <EmptyState
                icon={Sparkles}
                title="Your questions will appear here"
                body="Questions you ask across People and Notes will be saved here"
                level={3}
              />
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        onConfirm={handleClear}
        // The same words as Clear history in Privacy and AI.
        title="Clear search history?"
        description={`This deletes all ${totalCount} ${totalCount === 1 ? "question" : "questions"} you asked. It cannot be undone`}
        confirmLabel="Clear history"
      />
    </div>
  );

  if (children) {
    return <>{children({ count: totalCount, actions, body })}</>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-on-surface">History</h2>
          <Badge tone="neutral">{totalCount}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {actions}
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
      {body}
    </div>
  );
};
