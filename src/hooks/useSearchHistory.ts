/**
 * The account's recent searches, for the palette.
 *
 * - Stored on the account, not in `localStorage`, which is per origin: two
 *   people on one browser would share it. It follows the person to another
 *   device.
 * - Deduplicated without case: "VCs in SF" and "vcs in sf" are one search.
 * - 20 stored and 5 shown in the zero state, so a few evictions do not leave
 *   the shown list stale.
 * - No ↑/↓ recall, which would take the key from the list under it. The
 *   recent searches are rows in the empty palette instead.
 * - The palette opens with an empty box each time.
 */
import { useCallback, useMemo } from "react";
import { useSearchHistoryList, useRecordSearch } from "../api/searchHistory";
import { useHiddenPendingIds } from "../lib/pendingDeletes";
import { parseServerTime } from "../lib/datetime";
import type { HistoryMode } from "../../shared/searchHistory";

export interface SearchHistoryEntry {
  query: string;
  mode: "normal" | "ai" | "action" | "people" | "notes" | "palette";
  timestamp: number;
}

const MAX_DISPLAY = 5;

/** The server refuses anything longer, so trim rather than lose the entry. */
const MAX_QUERY_LENGTH = 200;

export const useSearchHistory = () => {
  const { data } = useSearchHistoryList();
  const recordMutation = useRecordSearch();

  const hiddenIds = useHiddenPendingIds();

  const entries: SearchHistoryEntry[] = useMemo(() => {
    const list = data?.pages.flatMap((p) => p.entries) ?? [];
    return list
      .filter((e) => e?.id && !hiddenIds.has(e.id))
      .map((e) => {
        const mode: SearchHistoryEntry["mode"] =
          e.mode === "people" ? "ai" : e.mode === "palette" ? "normal" : e.mode;
        const query =
          e.mode === "people" && !e.query.startsWith("?")
            ? `? ${e.query}`
            : e.query;
        const parsed = e.lastRunAt ? parseServerTime(e.lastRunAt) : null;
        const timestamp = parsed
          ? parsed.getTime()
          : e.lastRunAt
            ? new Date(e.lastRunAt).getTime()
            : Date.now();
        return {
          query,
          mode,
          timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
        };
      });
  }, [data, hiddenIds]);

  /**
   * Record a search: normal and action modes as `palette`, an AI or `?`
   * query as `people`, without the `?`.
   */
  const addEntry = useCallback(
    (
      query: string,
      mode: "normal" | "ai" | "action",
      meta?: {
        resultCount?: number;
        resultIds?: string[];
        fallback?: boolean;
      },
    ) => {
      const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
      if (trimmed.length < 2) return; // Don't record trivially short queries.

      const isAi = mode === "ai" || trimmed.startsWith("?");
      const targetMode: HistoryMode = isAi ? "people" : "palette";
      const targetQuery = isAi ? trimmed.replace(/^\?\s*/, "").trim() : trimmed;

      if (targetQuery.length < 1) return;

      recordMutation.mutate({
        query: targetQuery,
        mode: targetMode,
        resultCount: meta?.resultCount,
        resultIds: meta?.resultIds,
        fallback: meta?.fallback,
      });
    },
    [recordMutation],
  );

  /** Top N entries for the zero-state display. */
  const recentDisplay = useMemo(() => entries.slice(0, MAX_DISPLAY), [entries]);

  return {
    entries,
    recentDisplay,
    addEntry,
  };
};
