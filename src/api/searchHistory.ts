/**
 * Search History API Client — hooks for recording, listing, pinning,
 * and deleting questions asked on the Ask Contrack page and command palette.
 *
 * @module api/searchHistory
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { apiJson, jsonBody } from "./client";
import type {
  HistoryEntry,
  HistoryMode,
  RecordHistoryInput,
} from "../../shared/searchHistory";
import { normalizeQuery } from "../../shared/searchHistory";

export const SEARCH_HISTORY_KEY = ["searchHistory"] as const;

export interface HistoryListFilters {
  mode?: HistoryMode;
  q?: string;
  pinned?: boolean;
  limit?: number;
}

export interface HistoryListResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
  total: number;
}

export function searchHistoryListKey(filters?: HistoryListFilters) {
  return [...SEARCH_HISTORY_KEY, "list", filters ?? {}] as const;
}

/**
 * List search history entries with infinite cursor pagination.
 */
export function useSearchHistoryList(filters?: HistoryListFilters) {
  return useInfiniteQuery<HistoryListResponse, Error>({
    queryKey: searchHistoryListKey(filters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (filters?.mode) params.set("mode", filters.mode);
      if (filters?.q) params.set("q", filters.q);
      if (filters?.pinned !== undefined) {
        params.set("pinned", filters.pinned ? "1" : "0");
      }
      if (pageParam) params.set("cursor", String(pageParam));
      if (filters?.limit) params.set("limit", String(filters.limit));

      const queryStr = params.toString();
      const path = `/search/history${queryStr ? `?${queryStr}` : ""}`;
      return apiJson<HistoryListResponse>(path, { signal });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * Tracking the last recorded search to avoid double recording within 2 seconds.
 */
let lastRecorded: {
  mode: HistoryMode;
  normalizedQuery: string;
  time: number;
} | null = null;

export function shouldIgnoreRecord(
  mode: HistoryMode,
  query: string,
  now = Date.now(),
): boolean {
  const norm = normalizeQuery(query);
  if (
    lastRecorded &&
    lastRecorded.mode === mode &&
    lastRecorded.normalizedQuery === norm &&
    now - lastRecorded.time < 2000
  ) {
    return true;
  }
  lastRecorded = { mode, normalizedQuery: norm, time: now };
  return false;
}

/** Reset last recorded search. For testing only. */
export function resetLastRecorded(): void {
  lastRecorded = null;
}

/**
 * Record a completed search question.
 *
 * Optimistically inserts at the top of the search history infinite query cache,
 * and ignores records whose normalised query and mode equal the last one within 2 seconds.
 */
export function useRecordSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordHistoryInput) => {
      if (shouldIgnoreRecord(input.mode, input.query)) {
        return null;
      }
      return apiJson<{ entry: HistoryEntry }>("/search/history", {
        method: "POST",
        ...jsonBody(input),
      });
    },
    onMutate: async (input: RecordHistoryInput) => {
      const norm = normalizeQuery(input.query);
      if (
        lastRecorded &&
        lastRecorded.mode === input.mode &&
        lastRecorded.normalizedQuery === norm &&
        Date.now() - lastRecorded.time < 2000
      ) {
        return;
      }

      await queryClient.cancelQueries({ queryKey: SEARCH_HISTORY_KEY });
      const previous = queryClient.getQueriesData({
        queryKey: SEARCH_HISTORY_KEY,
      });

      const optimisticEntry: HistoryEntry = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId: "",
        mode: input.mode,
        query: input.query,
        normalizedQuery: norm,
        resultCount: input.resultCount ?? null,
        resultIds: input.resultIds?.slice(0, 30) ?? [],
        fallback: input.fallback ?? false,
        pinned: false,
        runCount: 1,
        createdAt: new Date().toISOString(),
        lastRunAt: new Date().toISOString(),
      };

      queryClient.setQueriesData<InfiniteData<HistoryListResponse>>(
        { queryKey: SEARCH_HISTORY_KEY },
        (old) => {
          if (!old || !old.pages.length) return old;
          const firstPage = old.pages[0];
          const filteredEntries = firstPage.entries.filter(
            (e) =>
              !(
                e.mode === optimisticEntry.mode &&
                e.normalizedQuery === optimisticEntry.normalizedQuery
              ),
          );
          const exists = filteredEntries.length < firstPage.entries.length;
          const newFirstPage: HistoryListResponse = {
            ...firstPage,
            entries: [optimisticEntry, ...filteredEntries],
            total: exists ? firstPage.total : firstPage.total + 1,
          };
          return {
            ...old,
            pages: [newFirstPage, ...old.pages.slice(1)],
          };
        },
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SEARCH_HISTORY_KEY });
    },
  });
}

/**
 * Toggle or set pinned state on a search history entry.
 */
export function useSetPinned() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      return apiJson<{ entry: HistoryEntry }>(
        `/search/history/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          ...jsonBody({ pinned }),
        },
      );
    },
    onMutate: async ({ id, pinned }) => {
      await queryClient.cancelQueries({ queryKey: SEARCH_HISTORY_KEY });
      const previous = queryClient.getQueriesData({
        queryKey: SEARCH_HISTORY_KEY,
      });

      queryClient.setQueriesData<InfiniteData<HistoryListResponse>>(
        { queryKey: SEARCH_HISTORY_KEY },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              entries: page.entries.map((e) =>
                e.id === id ? { ...e, pinned } : e,
              ),
            })),
          };
        },
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SEARCH_HISTORY_KEY });
    },
  });
}

/**
 * Delete a single search history entry.
 */
export function useDeleteHistoryEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiJson<{ success: boolean }>(
        `/search/history/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: SEARCH_HISTORY_KEY });
      const previous = queryClient.getQueriesData({
        queryKey: SEARCH_HISTORY_KEY,
      });

      queryClient.setQueriesData<InfiniteData<HistoryListResponse>>(
        { queryKey: SEARCH_HISTORY_KEY },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              entries: page.entries.filter((e) => e.id !== id),
              total: Math.max(0, page.total - 1),
            })),
          };
        },
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SEARCH_HISTORY_KEY });
    },
  });
}

/**
 * Clear search history, optionally filtered by mode.
 */
export function useClearHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mode?: HistoryMode) => {
      const path = mode
        ? `/search/history?mode=${encodeURIComponent(mode)}`
        : "/search/history";
      return apiJson<{ deleted: number }>(path, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SEARCH_HISTORY_KEY });
    },
  });
}
