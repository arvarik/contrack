/** Hooks to start an AI research batch and follow it, by stream or by poll. */
import { apiFetch, ApiError } from "./client";
import { invalidateContactViews } from "./contactCache";
import type { ResearchDepth } from "../../shared/researchDepth";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AISearchBatch } from "../types";

const API_BASE = "/api";

/** The batch schema, loaded with the first batch: zod is not on the first page load. */
const batchSchema = () =>
  import("../../shared/aiSearchContract").then((m) => m.aiSearchBatchSchema);

export const useStartAISearch = () => {
  return useMutation({
    mutationFn: async ({
      contactIds,
      depth,
      strategy,
    }: {
      contactIds: string[];
      /** How thoroughly to research. The server's default is "standard". */
      depth?: ResearchDepth;
      /**
       * The web search model's own search, SearXNG alone, or both. The
       * account's web search engine when absent.
       */
      strategy?: "two-pass" | "searxng" | "combined";
    }) => {
      // A refusal throws `ApiError` with the server's words. A 429 here means
      // another account's batch holds the research lock, and it carries
      // `details.yours` (see `rateLimitFacts`).
      const res = await apiFetch(`/ai-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds, depth, strategy }),
      });
      // `appended`: the contacts joined this account's running batch, whose
      // id this is, instead of starting one.
      return res.json() as Promise<{
        batchId: string;
        jobCount: number;
        appended?: boolean;
      }>;
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
      const batch = (await batchSchema()).parse(await res.json());
      if (batch.id !== batchId)
        throw new Error("The server returned a different research batch");
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
    // The stream opens once the schema is here, so each event is checked as
    // it lands. The poll covers the wait, and a failed download, which opens
    // no stream.
    let source: EventSource | undefined;
    let stopped = false;
    void batchSchema()
      .catch(() => null)
      .then((schema) => {
        if (!schema) return;
        if (stopped) return;
        const stream = new EventSource(
          `${API_BASE}/ai-search/stream?batchId=${encodeURIComponent(batchId)}`,
        );
        source = stream;
        stream.onmessage = (event) => {
          const parsed = schema.safeParse(safeJson(event.data));
          if (!parsed.success || parsed.data.id !== batchId) {
            stream.close();
            return;
          }
          queryClient.setQueryData(["ai-search-status", batchId], parsed.data);
          if (parsed.data.status !== "processing") stream.close();
        };
        stream.onerror = () => {
          stream.close();
          void queryClient.invalidateQueries({
            queryKey: ["ai-search-status", batchId],
          });
        };
      });
    return () => {
      stopped = true;
      source?.close();
    };
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
      return (await batchSchema()).parse(await response.json());
    },
    onSuccess: (batch) =>
      client.setQueryData(["ai-search-status", batch.id], batch),
  });
};
