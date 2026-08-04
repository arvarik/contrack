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
 *
 * @module api/suggestions
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PersistedDedupeSuggestion, MergeLogEntry } from "../types";

const API = "/api";

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
    queryFn: async () => {
      const res = await fetch(`${API}/dedupe/suggestions/count`);
      if (!res.ok) return { count: 0 };
      return res.json() as Promise<{ count: number }>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

/** Hydrated pending suggestions for the review queue. */
export const usePendingSuggestions = (enabled = true) =>
  useQuery({
    queryKey: suggestionKeys.pending,
    queryFn: async () => {
      const res = await fetch(`${API}/dedupe/suggestions?limit=200`);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      const data = await res.json();
      return data.suggestions as PersistedDedupeSuggestion[];
    },
    enabled,
    staleTime: 15_000,
  });

/** Check if a specific contact has a pending suggestion (for detail page banner). */
export const useSuggestionForContact = (contactId: string | undefined) =>
  useQuery({
    queryKey: suggestionKeys.forContact(contactId!),
    queryFn: async () => {
      const res = await fetch(`${API}/dedupe/suggestion-for/${contactId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.suggestion ?? null;
    },
    enabled: !!contactId,
    staleTime: 30_000,
  });

/** Recent merge audit log. */
export const useMergeLog = (enabled = true) =>
  useQuery({
    queryKey: suggestionKeys.mergeLog,
    queryFn: async () => {
      const res = await fetch(`${API}/dedupe/merge-log?limit=100`);
      if (!res.ok) throw new Error("Failed to fetch merge log");
      const data = await res.json();
      return data.entries as MergeLogEntry[];
    },
    enabled,
    staleTime: 15_000,
  });

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
      const res = await fetch(
        `${API}/dedupe/suggestions/${suggestionId}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryId }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Merge failed");
      }
      return res.json();
    },
    onSuccess: () => {
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
      const res = await fetch(
        `${API}/dedupe/suggestions/${suggestionId}/dismiss`,
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
    mutationFn: async (mergeLogId: string) => {
      const res = await fetch(`${API}/dedupe/merge-log/${mergeLogId}/undo`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Undo failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suggestionKeys.count });
      qc.invalidateQueries({ queryKey: suggestionKeys.pending });
      qc.invalidateQueries({ queryKey: suggestionKeys.mergeLog });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};
