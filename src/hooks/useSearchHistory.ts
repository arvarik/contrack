/**
 * useSearchHistory — the account's recent searches, for the palette.
 *
 * Design decisions:
 * - Stored on the account, not in the browser. A search history is a list of
 *   the things somebody looked for, and `localStorage` is keyed by origin: two
 *   people using one browser shared the list, and clearing it cleared both.
 *   It also now follows the person to another device, which is what makes
 *   "that query I ran yesterday" work at all.
 * - Case-insensitive deduplication: "VCs in SF" and "vcs in sf" are the same.
 * - Max 20 stored, max 5 displayed in the zero state. The extra headroom keeps
 *   the display list from feeling stale after a few evictions.
 * - No ↑/↓ recall. ↑ on an empty palette used to fill the input with the
 *   last query, and took the key from the list under it. The recent searches
 *   are rows in the empty palette instead.
 * - No restore when the palette opens again. It opens with an empty box each
 *   time. A 30-second restore used to be here, and nothing called it.
 *
 * @module src/hooks/useSearchHistory
 */
import { useCallback, useMemo } from "react";
import {
  useSearchHistoryList,
  useRecordSearch,
  useClearHistory,
} from "../api/searchHistory";
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
  const clearMutation = useClearHistory();

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
   * Record a successful search. Calls useRecordSearch with:
   * - normal and action as palette
   * - ? q as people with the prefix stripped
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

  /** Clear all search history. */
  const clearHistory = useCallback(() => {
    clearMutation.mutate(undefined);
  }, [clearMutation]);

  /** Top N entries for the zero-state display. */
  const recentDisplay = useMemo(() => entries.slice(0, MAX_DISPLAY), [entries]);

  return {
    entries,
    recentDisplay,
    addEntry,
    clearHistory,
  };
};
