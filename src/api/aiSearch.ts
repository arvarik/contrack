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
      const res = await fetch(`${API_BASE}/ai-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start AI Search");
      }
      return res.json() as Promise<{ batchId: string; jobCount: number }>;
    },
  });
};

// =============================================================================
// SSE-based batch status hook (primary)
// =============================================================================

/**
 * Connects to the SSE stream endpoint for real-time batch updates.
 * Calls onUpdate for every state change. Automatically closes on completion.
 * Falls back gracefully if SSE is unavailable.
 */
export const useAISearchStream = (
  batchId: string | null,
  onUpdate: (batch: AISearchBatch) => void,
) => {
  const queryClient = useQueryClient();
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!batchId) return;

    const source = new EventSource(
      `${API_BASE}/ai-search/stream?batchId=${batchId}`,
    );

    source.onmessage = (event) => {
      try {
        const batch: AISearchBatch = JSON.parse(event.data);
        onUpdateRef.current(batch);
        if (batch.status === "complete" || batch.status === "cancelled") {
          // Invalidate all contact queries so updated data appears everywhere
          queryClient.invalidateQueries({ queryKey: ["contacts"] });
          // Also invalidate each individual contact that was enriched
          for (const job of batch.jobs) {
            if (job.fieldsUpdated > 0) {
              queryClient.invalidateQueries({
                queryKey: ["contacts", job.contactId],
              });
            }
          }
          source.close();
        }
      } catch {
        // Ignore parse errors on individual events
      }
    };

    source.onerror = () => {
      // SSE failed — the component can fall back to polling
      source.close();
    };

    return () => source.close();
  }, [batchId, queryClient]);
};

// =============================================================================
// Polling fallback hook
// =============================================================================

/** Polling fallback: only used when SSE is unavailable */
export const useAISearchStatusPoll = (batchId: string | null) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["ai-search-status", batchId],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/ai-search/status?batchId=${batchId}`,
      );
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json() as Promise<AISearchBatch>;
    },
    enabled: !!batchId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status === "complete" || data.status === "cancelled") {
        if (data?.status === "complete") {
          queryClient.invalidateQueries({ queryKey: ["contacts"] });
        }
        return false;
      }
      // Adaptive: fast when active, slower when idle between contacts
      const active = data.jobs.filter(
        (j) => j.status === "searching" || j.status === "merging",
      ).length;
      return active > 0 ? 1000 : 3000;
    },
  });
};
