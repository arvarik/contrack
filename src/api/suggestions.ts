import { apiFetch } from "./client";
import { corvidReact } from "../lib/corvid";
/**
 * Suggestions API Hooks — React Query hooks for the persistent dedupe suggestions system.
 *
 * Provides:
 * - `useDedupeCount`          — Pending suggestion count (sidebar badge)
 * - `usePendingSuggestions`   — Hydrated suggestion list (review queue)
 * - `useSuggestionForContact` — Single-contact lookup (detail page banner)
 * - `useMergeSuggestion`      — Merge via suggestion ID
 * - `useDismissSuggestion`    — Dismiss + add exclusion
 * - `useMergeLog`             — Recent merge audit log
 * - `useUndoMerge`            — Undo a soft merge
 * - `useUndoClusterMerge`     — Undo every merge of one cluster merge
 *
 * @module api/suggestions
 */
import { useCallback } from "react";
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  PersistedDedupeSuggestion,
  MergeLogEntry,
  UndoMergeResponse,
} from "../types";

// =============================================================================
// Query Keys
// =============================================================================

export const suggestionKeys = {
  count: ["dedupe-suggestions-count"] as const,
  pending: ["dedupe-suggestions"] as const,
  forContact: (id: string) => ["dedupe-suggestion", id] as const,
  mergeLog: ["dedupe-merge-log"] as const,
};

// =============================================================================
// Queries
// =============================================================================

/** Pending suggestion count — powers the sidebar badge. Polls every 60s. */
export const useDedupeCount = () =>
  useQuery({
    queryKey: suggestionKeys.count,
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/dedupe/suggestions/count`, { signal });
      if (!res.ok) return { count: 0 };
      return res.json() as Promise<{ count: number }>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

/** Hydrated pending suggestions for the review queue. */
export const usePendingSuggestions = () =>
  useQuery({
    queryKey: suggestionKeys.pending,
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/dedupe/suggestions?limit=200`, { signal });
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      const data = await res.json();
      return data.suggestions as PersistedDedupeSuggestion[];
    },
    staleTime: 15_000,
  });

/** Check if a specific contact has a pending suggestion (for detail page banner). */
export const suggestionQuery = (contactId: string) =>
  queryOptions({
    queryKey: suggestionKeys.forContact(contactId),
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/dedupe/suggestion-for/${contactId}`, {
        signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.suggestion ?? null;
    },
    staleTime: 30_000,
  });

export const useSuggestionForContact = (contactId: string | undefined) =>
  useQuery({ ...suggestionQuery(contactId ?? ""), enabled: !!contactId });

const mergeLogQuery = queryOptions({
  queryKey: suggestionKeys.mergeLog,
  queryFn: async ({ signal }) => {
    const res = await apiFetch(`/dedupe/merge-log?limit=100`, { signal });
    if (!res.ok) throw new Error("Failed to fetch merge log");
    const data = await res.json();
    return data.entries as MergeLogEntry[];
  },
  staleTime: 15_000,
});

/** Recent merge audit log. */
export const useMergeLog = () => useQuery(mergeLogQuery);

// =============================================================================
// Mutations
// =============================================================================

/** Merge a suggestion — the primary stays, the other is soft-merged. */
export const useMergeSuggestion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      suggestionId,
      primaryId,
    }: {
      suggestionId: string;
      primaryId: string;
    }) => {
      const res = await apiFetch(`/dedupe/suggestions/${suggestionId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Merge failed");
      }
      return res.json();
    },
    onSuccess: () => {
      // Two records made one: the corvid tidies its own feathers.
      corvidReact("preen");
      qc.invalidateQueries({ queryKey: suggestionKeys.count });
      qc.invalidateQueries({ queryKey: suggestionKeys.pending });
      qc.invalidateQueries({ queryKey: suggestionKeys.mergeLog });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};

/** Dismiss a suggestion — adds to exclusions, never re-suggested. */
export const useDismissSuggestion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (suggestionId: string) => {
      const res = await apiFetch(
        `/dedupe/suggestions/${suggestionId}/dismiss`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Dismiss failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suggestionKeys.count });
      qc.invalidateQueries({ queryKey: suggestionKeys.pending });
    },
  });
};

/** Undo a soft merge — restores the duplicate contact. */
export const useUndoMerge = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mergeLogId: string): Promise<UndoMergeResponse> => {
      const res = await apiFetch(`/dedupe/merge-log/${mergeLogId}/undo`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Undo failed");
      }
      return res.json() as Promise<UndoMergeResponse>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suggestionKeys.count });
      qc.invalidateQueries({ queryKey: suggestionKeys.pending });
      qc.invalidateQueries({ queryKey: suggestionKeys.mergeLog });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};

/**
 * Undo a cluster merge, which is one merge per duplicate.
 *
 * The merge answers with no merge-log ids, so they are read from the log:
 * a duplicate has one entry that is not undone. They are undone last merge
 * first, because each merge changed the primary the next one started from.
 * The log cannot give that order: its times are to the second.
 */
export const useUndoClusterMerge = () => {
  const qc = useQueryClient();
  const { mutateAsync: undo } = useUndoMerge();
  return useCallback(
    async (primaryId: string, duplicateIds: string[]) => {
      const log = await qc.fetchQuery({ ...mergeLogQuery, staleTime: 0 });
      const ids = duplicateIds
        .flatMap(
          (duplicateId) =>
            log.find(
              (e) =>
                e.primaryId === primaryId &&
                e.duplicateId === duplicateId &&
                !e.undoneAt,
            )?.id ?? [],
        )
        .reverse();
      if (ids.length === 0)
        throw new Error("The merge is no longer in the log");
      for (const id of ids) await undo(id);
    },
    [qc, undo],
  );
};
