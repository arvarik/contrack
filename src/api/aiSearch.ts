import { apiFetch, ApiError } from "./client";
import { aiSearchBatchSchema } from "../../shared/aiSearchContract";
import { invalidateContactViews } from "./contactCache";
/**
 * AI Search — React Query hooks and SSE streaming.
 *
 * Primary hook: useAISearchStream (SSE-based, real-time)
 * Fallback hook: useAISearchStatusPoll (polling-based)
 * Mutation: useStartAISearch (kicks off a batch)
 */

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AISearchBatch } from "../types";

const API_BASE = "/api";

// =============================================================================
// Start AI Search mutation
// =============================================================================

export const useStartAISearch = () => {
  return useMutation({
    mutationFn: async (contactIds: string[]) => {
      // `apiFetch` throws `ApiError` for any non-2xx, with the message read
      // out of the standard `{ error: { code, message } }` envelope, so the
      // caller's `onError` toast shows the server's own words. The cooldown
      // 429 used to be the one endpoint that answered with a bare
      // `{ error: string }`; since 2f it sends the envelope like everything
      // else, and carries `details.yours` for Phase 4 to act on.
      const res = await apiFetch(`/ai-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds }),
      });
      return res.json() as Promise<{ batchId: string; jobCount: number }>;
    },
  });
};

/** Poll after transient errors and stop only after a terminal result or a missing batch. */
export const useAISearchStatusPoll = (batchId: string | null) => {
  return useQuery({
    queryKey: ["ai-search-status", batchId],
    queryFn: async ({ signal }) => {
      const res = await apiFetch(
        `/ai-search/status?batchId=${encodeURIComponent(batchId!)}`,
        { signal },
      );
      const batch = aiSearchBatchSchema.parse(await res.json());
      if (batch.id !== batchId)
        throw new Error("The server returned a different research batch.");
      return batch;
    },
    enabled: !!batchId,
    refetchInterval: (query) => {
      if (
        query.state.error instanceof ApiError &&
        query.state.error.status === 404
      )
        return false;
      const data = query.state.data;
      if (data && data.status !== "processing") return false;
      return data?.jobs.some(
        (job) => job.status === "searching" || job.status === "merging",
      )
        ? 2000
        : 5000;
    },
  });
};

/** Live events update the same cache that polling uses, so dropped streams cannot freeze progress. */
export const useAISearchStream = (
  batchId: string | null,
  onUpdate: (batch: AISearchBatch) => void,
) => {
  const queryClient = useQueryClient();
  const poll = useAISearchStatusPoll(batchId);
  const onUpdateRef = useRef(onUpdate);
  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    refreshed.current.clear();
  }, [batchId]);
  useEffect(() => {
    const batch = poll.data;
    if (!batch || batch.id !== batchId) return;
    onUpdateRef.current(batch);
    const completed = batch.jobs.filter(
      (job) => job.status === "success" && !refreshed.current.has(job.id),
    );
    if (completed.length) {
      completed.forEach((job) => refreshed.current.add(job.id));
      invalidateContactViews(queryClient);
    }
  }, [batchId, poll.data, queryClient]);
  useEffect(() => {
    if (!batchId) return;
    const source = new EventSource(
      `${API_BASE}/ai-search/stream?batchId=${encodeURIComponent(batchId)}`,
    );
    source.onmessage = (event) => {
      const parsed = aiSearchBatchSchema.safeParse(safeJson(event.data));
      if (!parsed.success || parsed.data.id !== batchId) {
        source.close();
        return;
      }
      queryClient.setQueryData(["ai-search-status", batchId], parsed.data);
      if (parsed.data.status !== "processing") source.close();
    };
    source.onerror = () => {
      source.close();
      void queryClient.invalidateQueries({
        queryKey: ["ai-search-status", batchId],
      });
    };
    return () => source.close();
  }, [batchId, queryClient]);
  return { error: poll.error };
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const useCancelAISearch = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const response = await apiFetch(
        `/ai-search/${encodeURIComponent(batchId)}/cancel`,
        { method: "POST" },
      );
      return aiSearchBatchSchema.parse(await response.json());
    },
    onSuccess: (batch) =>
      client.setQueryData(["ai-search-status", batch.id], batch),
  });
};
