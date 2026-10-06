/** Hooks for the history of questions asked on Ask and in the palette. */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { apiJson, jsonBody } from "./client";
import type {
  HistoryEntry,
  HistoryMode,
  RecordHistoryInput,
} from "../../shared/searchHistory";
import { normalizeQuery } from "../../shared/searchHistory";

const SEARCH_HISTORY_KEY = ["searchHistory"] as const;

interface HistoryListFilters {
  mode?: HistoryMode;
  q?: string;
  pinned?: boolean;
  limit?: number;
}

interface HistoryListResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
  total: number;
}

function searchHistoryListKey(filters?: HistoryListFilters) {
  return [...SEARCH_HISTORY_KEY, "list", filters ?? {}] as const;
}

/** Search history, a cursor page at a time. */
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

type HistoryPages = InfiniteData<HistoryListResponse>;

/**
 * Edits every cached history list before the server answers, and returns
 * what they held, for `restoreHistory`.
 */
async function editHistory(
  queryClient: QueryClient,
  edit: (old: HistoryPages) => HistoryPages,
) {
  await queryClient.cancelQueries({ queryKey: SEARCH_HISTORY_KEY });
  const previous = queryClient.getQueriesData({ queryKey: SEARCH_HISTORY_KEY });
  queryClient.setQueriesData<HistoryPages>(
    { queryKey: SEARCH_HISTORY_KEY },
    (old) => old && edit(old),
  );
  return { previous };
}

/** A failed write puts the cached lists back. Every write refetches them. */
function restoreHistory(queryClient: QueryClient) {
  return {
    onError: (
      _err: unknown,
      _vars: unknown,
      context: Awaited<ReturnType<typeof editHistory>> | void,
    ) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SEARCH_HISTORY_KEY });
    },
  };
}

/** The last recorded search, so a repeat within 2 seconds is not recorded. */
let lastRecorded: {
  mode: HistoryMode;
  normalizedQuery: string;
  time: number;
} | null = null;

function shouldIgnoreRecord(mode: HistoryMode, query: string): boolean {
  const now = Date.now();
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

/**
 * Records a finished question at the top of the cached history. A repeat of
 * the last normalized query and mode within 2 seconds is ignored.
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

      return editHistory(queryClient, (old) => {
        if (!old.pages.length) return old;
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
      });
    },
    ...restoreHistory(queryClient),
  });
}

/** Pins or unpins a history entry. */
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
    onMutate: ({ id, pinned }) =>
      editHistory(queryClient, (old) => ({
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          entries: page.entries.map((e) =>
            e.id === id ? { ...e, pinned } : e,
          ),
        })),
      })),
    ...restoreHistory(queryClient),
  });
}

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
    onMutate: (id: string) =>
      editHistory(queryClient, (old) => ({
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          entries: page.entries.filter((e) => e.id !== id),
          total: Math.max(0, page.total - 1),
        })),
      })),
    ...restoreHistory(queryClient),
  });
}

/** Clears the history, or one mode's. */
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
