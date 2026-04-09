/**
 * Deduplication API Hooks — React Query hooks for the async duplicate detection engine.
 *
 * Provides:
 * - `useStartDedupeScan` — Kicks off a background scan with mode selection
 * - `useDedupeStream` — SSE hook for real-time scan progress
 * - `useMergeContacts` — Merge a single pair
 * - `useMergeBatch` — Bulk merge multiple pairs (list view)
 * - `useMergeCluster` — Merge an entire cluster into one contact
 * - `useMergeClusters` — Bulk merge multiple clusters
 * - `useSeedDuplicates` — Dev-only seed utility
 *
 * @module api/dedupe
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DedupeScanMode, DedupeScanProgress } from '../types';

const API_BASE = '/api';

// =============================================================================
// Start dedupe scan mutation
// =============================================================================

export const useStartDedupeScan = () => {
  return useMutation({
    mutationFn: async (mode: DedupeScanMode) => {
      const res = await fetch(`${API_BASE}/dedupe/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to start scan');
      }
      return res.json() as Promise<{ scanId: string; mode: DedupeScanMode }>;
    },
  });
};

// =============================================================================
// Active scan discovery (for state recovery after refresh)
// =============================================================================

/**
 * Check if the server has an in-progress scan.
 * Returns the scan progress if active, or null if idle.
 */
export async function fetchActiveScan(): Promise<DedupeScanProgress | null> {
  try {
    const res = await fetch(`${API_BASE}/dedupe/active`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.active && data.scan) return data.scan as DedupeScanProgress;
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// SSE-based scan progress hook
// =============================================================================

/** Max SSE reconnection attempts before giving up */
const SSE_MAX_RETRIES = 3;
/** Delay between SSE reconnection attempts (ms) */
const SSE_RETRY_DELAY_MS = 2000;

/**
 * Connects to the SSE stream endpoint for real-time dedupe scan progress.
 * Calls onUpdate for every state change. Automatically closes on completion.
 * Includes retry logic for transient disconnects during long AI batch processing.
 */
export const useDedupeStream = (
  scanId: string | null,
  onUpdate: (scan: DedupeScanProgress) => void,
) => {
  const queryClient = useQueryClient();
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!scanId) return;

    let retries = 0;
    let source: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;

      source = new EventSource(`${API_BASE}/dedupe/stream?scanId=${scanId}`);

      source.onmessage = (event) => {
        try {
          const scan: DedupeScanProgress = JSON.parse(event.data);
          retries = 0; // Reset retry count on successful message
          onUpdateRef.current(scan);
          if (scan.phase === 'complete' || scan.phase === 'error') {
            // Invalidate contacts cache so merged data appears everywhere
            queryClient.invalidateQueries({ queryKey: ['contacts'] });
            source?.close();
            closed = true;
          }
        } catch {
          // Ignore parse errors on individual events
        }
      };

      source.onerror = () => {
        source?.close();
        // Retry on transient errors (e.g., SSE timeout during long AI batch)
        if (!closed && retries < SSE_MAX_RETRIES) {
          retries++;
          setTimeout(connect, SSE_RETRY_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      closed = true;
      source?.close();
    };
  }, [scanId, queryClient]);
};

// =============================================================================
// Merge mutations
// =============================================================================

export const useMergeContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ primaryId, duplicateId }: { primaryId: string; duplicateId: string }) => {
      const res = await fetch(`${API_BASE}/contacts/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId, duplicateId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Merge failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

export const useMergeBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (merges: { primaryId: string; duplicateId: string }[]) => {
      const res = await fetch(`${API_BASE}/contacts/merge-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merges }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Batch merge failed');
      }
      return res.json() as Promise<{
        results: { primaryId: string; duplicateId: string; success: boolean; error?: string }[];
        succeeded: number;
        total: number;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

// =============================================================================
// Cluster merge mutations
// =============================================================================

/**
 * Merge all duplicate contacts in a cluster into a single primary contact.
 * The server merges each duplicate sequentially and isolates per-duplicate errors.
 */
export const useMergeCluster = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ primaryId, duplicateIds }: { primaryId: string; duplicateIds: string[] }) => {
      const res = await fetch(`${API_BASE}/contacts/merge-cluster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId, duplicateIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Cluster merge failed');
      }
      return res.json() as Promise<{
        success: boolean;
        merged: number;
        failed: number;
        contact: any;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

/**
 * Bulk merge multiple clusters in a single request.
 * Each cluster specifies a primaryId and an array of duplicateIds.
 */
export const useMergeClusters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (clusters: { primaryId: string; duplicateIds: string[] }[]) => {
      const res = await fetch(`${API_BASE}/contacts/merge-clusters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusters }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Batch cluster merge failed');
      }
      return res.json() as Promise<{
        results: { primaryId: string; merged: number; failed: number }[];
        totalMerged: number;
        totalFailed: number;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};

// =============================================================================
// Dev-only seed
// =============================================================================

export const useSeedDuplicates = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/dev/seed-duplicates`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to seed duplicates');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
};
