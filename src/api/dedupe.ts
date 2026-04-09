/**
 * Deduplication API Hooks — React Query hooks for the async duplicate detection engine.
 *
 * Provides:
 * - `useStartDedupeScan` — Kicks off a background scan with mode selection
 * - `useDedupeStream` — SSE hook for real-time scan progress
 * - `useMergeContacts` — Merge a single pair
 * - `useMergeBatch` — Bulk merge multiple pairs (list view)
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
// SSE-based scan progress hook
// =============================================================================

/**
 * Connects to the SSE stream endpoint for real-time dedupe scan progress.
 * Calls onUpdate for every state change. Automatically closes on completion.
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

    const source = new EventSource(`${API_BASE}/dedupe/stream?scanId=${scanId}`);

    source.onmessage = (event) => {
      try {
        const scan: DedupeScanProgress = JSON.parse(event.data);
        onUpdateRef.current(scan);
        if (scan.phase === 'complete' || scan.phase === 'error') {
          // Invalidate contacts cache so merged data appears everywhere
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
          source.close();
        }
      } catch {
        // Ignore parse errors on individual events
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => source.close();
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
