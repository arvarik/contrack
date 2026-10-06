import { apiFetch, apiJson, jsonBody } from "./client";
/**
 * Suggestions API Hooks — React Query hooks for the persistent dedupe suggestions system.
 *
 * Provides:
 * - `useDedupeCount`          — Possible duplicates, counted in groups (the badges)
 * - `usePendingSuggestions`   — Hydrated suggestion list (the review list)
 * - `useSuggestionForContact` — Single-contact lookup (detail page banner)
 * - `useDismissSuggestion`    — Keep a pair separate: dismiss + add exclusion
 * - `useRestoreSuggestion`    — Undo of Keep separate
 * - `useMergeLog`             — Recent merges, for Merge history
 * - `useUndoMerge`            — Undo one merge
 * - `undoMerges`              — Undo several merges, the last first
 * - `useMergedInto`           — Where a merged contact went
 *
 * @module api/suggestions
 */
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { PersistedDedupeSuggestion, MergeLogEntry } from "../types";
import { dedupeRoutes } from "../../shared/contracts/dedupe";
import type { ResponseOf } from "../../shared/contracts/route";

/** What one undo answers: the contact it restored, and what changed since. */
export type UndoMergeResponse = ResponseOf<typeof dedupeRoutes.undo>;

// =============================================================================
// Query Keys
// =============================================================================

const suggestionKeys = {
  count: ["dedupe-suggestions-count"] as const,
  pending: ["dedupe-suggestions"] as const,
  /** Every contact page's banner: one key to refresh them all. */
  forContactAll: ["dedupe-suggestion"] as const,
  forContact: (id: string) => ["dedupe-suggestion", id] as const,
  mergeLog: ["dedupe-merge-log"] as const,
  mergedInto: (id: string) => ["dedupe-merged-into", id] as const,
};

/**
 * After anything that changes which pairs wait: the list, its count, every
 * contact page's banner and Merge history read the server again, and the
 * contacts too when a merge or an undo changed them.
 */
export function refreshDuplicates(
  qc: QueryClient,
  { contacts = false }: { contacts?: boolean } = {},
): void {
  void qc.invalidateQueries({ queryKey: suggestionKeys.count });
  void qc.invalidateQueries({ queryKey: suggestionKeys.pending });
  void qc.invalidateQueries({ queryKey: suggestionKeys.forContactAll });
  void qc.invalidateQueries({ queryKey: suggestionKeys.mergeLog });
  void qc.invalidateQueries({ queryKey: ["zeroState"] });
  if (contacts) void qc.invalidateQueries({ queryKey: ["contacts"] });
}

// =============================================================================
// Queries
// =============================================================================

/** Pending suggestion count — powers the sidebar badge. Polls every 60s. */
export const useDedupeCount = () =>
  useQuery({
    queryKey: suggestionKeys.count,
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/dedupe/suggestions/count`, { signal });
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
    const res = await apiFetch(`/dedupe/merge-log?limit=50`, { signal });
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

/** Dismiss a suggestion — adds to exclusions, never re-suggested. */
export const useDismissSuggestion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) =>
      apiJson<{ success: true }>(
        `/dedupe/suggestions/${suggestionId}/dismiss`,
        { method: "POST" },
      ),
    onSuccess: () => refreshDuplicates(qc),
  });
};

/**
 * Undo of Keep separate: the pair waits in Possible duplicates again, and
 * the two are no longer marked as different people.
 */
export const useRestoreSuggestion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) =>
      apiJson(
        dedupeRoutes.restore,
        `/dedupe/suggestions/${encodeURIComponent(suggestionId)}/restore`,
      ),
    onSuccess: () => refreshDuplicates(qc),
  });
};

/**
 * Undo one merge.
 *
 * `keepSeparate` says what the undo means. From Merge history, or after a
 * merge Contrack made by itself, it means the two are different people, so
 * nothing merges or suggests them again: the default, and the server's.
 * The Undo in the message right after a person's own merge sends `false`:
 * that undo takes back a key pressed by mistake, and the pair waits again.
 */
function undoMerge(
  mergeLogId: string,
  keepSeparate: boolean,
): Promise<UndoMergeResponse> {
  return apiJson(
    dedupeRoutes.undo,
    `/dedupe/merge-log/${encodeURIComponent(mergeLogId)}/undo`,
    jsonBody({ keepSeparate }),
  );
}

/**
 * Undo the merges of one action, the last merge first: each merge changed
 * the contact the next one started from.
 */
export async function undoMerges(
  qc: QueryClient,
  mergeLogIds: string[],
  keepSeparate: boolean,
): Promise<UndoMergeResponse[]> {
  const results: UndoMergeResponse[] = [];
  try {
    for (const id of [...mergeLogIds].reverse()) {
      results.push(await undoMerge(id, keepSeparate));
    }
  } finally {
    refreshDuplicates(qc, { contacts: true });
  }
  return results;
}

/** Undo one merge from Merge history. */
export const useUndoMerge = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      mergeLogId,
      keepSeparate = true,
    }: {
      mergeLogId: string;
      keepSeparate?: boolean;
    }) => undoMerge(mergeLogId, keepSeparate),
    onSuccess: () => refreshDuplicates(qc, { contacts: true }),
  });
};

/** One merge, as `GET /api/dedupe/merged-into/:contactId` answers it. */
export type MergedInto = NonNullable<
  ResponseOf<typeof dedupeRoutes.mergedInto>["merge"]
>;

/** Where a contact went when it was merged, or null for a live contact. */
export const fetchMergedInto = async (
  contactId: string,
): Promise<MergedInto | null> => {
  const data = await apiJson(
    dedupeRoutes.mergedInto,
    `/dedupe/merged-into/${encodeURIComponent(contactId)}`,
  );
  return data.merge;
};

/**
 * The contact page asks once it sees the contact was merged away. Always
 * fresh: an undo changes the answer, and a cached one sent the page back to
 * the contact it had just left.
 */
export const useMergedInto = (contactId: string, enabled: boolean) =>
  useQuery({
    queryKey: suggestionKeys.mergedInto(contactId),
    queryFn: () => fetchMergedInto(contactId),
    enabled,
    staleTime: 0,
  });

/**
 * Forget what the cache knows about a contact's merge, before its page opens
 * again after an undo: the contact as it was merged, and where it went.
 */
export function forgetMerge(qc: QueryClient, contactId: string): void {
  qc.removeQueries({ queryKey: ["contacts", contactId], exact: true });
  qc.removeQueries({ queryKey: suggestionKeys.mergedInto(contactId) });
}
