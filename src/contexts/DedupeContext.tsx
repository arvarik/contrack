/**
 * DedupeContext — Global state for the Dedupe Engine.
 *
 * Provides:
 * - startScan(mode): kicks off an async scan and connects SSE
 * - scan: current scan progress (live-updated via SSE)
 * - clusters: final cluster results when scan is complete
 * - isScanning: whether a scan is in progress
 * - reset(): clear state for a new scan
 *
 * State persists across route changes because this provider is mounted
 * at the App root, allowing the user to navigate away and return.
 *
 * On mount, checks the server for any in-progress scan and recovers
 * the SSE connection — handles page refresh during an active scan.
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useStartDedupeScan, useDedupeStream, fetchActiveScan } from '../api/dedupe';
import { toast } from 'sonner';
import type { DedupeScanMode, DedupeScanProgress, DedupeCluster } from '../types';

interface DedupeContextValue {
  startScan: (mode: DedupeScanMode, autoMergeThreshold?: number) => void;
  scan: DedupeScanProgress | null;
  /** Cluster-based results from the latest scan. */
  clusters: DedupeCluster[];
  isScanning: boolean;
  isStarting: boolean;
  reset: () => void;
  /** Remove a cluster from the local list (after merge or dismiss) */
  removeCluster: (id: string) => void;
}

const DedupeContext = createContext<DedupeContextValue | null>(null);

export function useDedupe() {
  const ctx = useContext(DedupeContext);
  if (!ctx) throw new Error('useDedupe must be used within DedupeProvider');
  return ctx;
}

export function DedupeProvider({ children }: { children: React.ReactNode }) {
  const [scan, setScan] = useState<DedupeScanProgress | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [clusters, setClusters] = useState<DedupeCluster[]>([]);
  const startMutation = useStartDedupeScan();

  // On mount, check if the server has an in-progress scan and recover state.
  // This handles page refresh during an active scan — without it, the user
  // would see the pre-scan page while the server is still processing.
  useEffect(() => {
    let cancelled = false;
    fetchActiveScan().then(activeScan => {
      if (cancelled || !activeScan) return;
      // Only recover if we don't already have a scan in progress
      if (!scanId) {
        setScan(activeScan);
        setScanId(activeScan.scanId);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  // SSE stream hook — updates scan state in real-time
  const handleUpdate = useCallback((updatedScan: DedupeScanProgress) => {
    setScan(updatedScan);
    // When complete, capture the final clusters
    if (updatedScan.phase === 'complete') {
      setClusters(updatedScan.clusters ?? []);
    }
  }, []);

  useDedupeStream(scanId, handleUpdate);

  const startScan = useCallback((mode: DedupeScanMode, autoMergeThreshold?: number) => {
    startMutation.mutate({ mode, autoMergeThreshold }, {
      onSuccess: (result) => {
        // Set optimistic scan state BEFORE the SSE event arrives.
        // This prevents the pre-scan page from briefly flashing back during the
        // ~100-300ms gap between isStarting going false and the first SSE message.
        setScan({
          scanId: result.scanId,
          mode: result.mode,
          phase: 'starting',
          phaseName: 'Initializing scan…',
          contactsScanned: 0,
          totalContacts: 0,
          deterministicFound: 0,
          aiCandidatesFound: 0,
          aiEvaluated: 0,
          blockingCandidates: 0,
          scoringAutoMerge: 0,
          scoringAiQueue: 0,
          scoringDiscarded: 0,
          suggestions: [],
          clustersFound: 0,
          totalPairs: 0,
          autoMerged: 0,
          pendingSuggestions: 0,
          clusters: [],
          startedAt: new Date().toISOString(),
        });
        setScanId(result.scanId);
        setClusters([]);
        const modeLabels: Record<string, string> = { quick: 'Quick Scan', deep: 'Smart Scan', full: 'Full Scan', deterministic: 'Quick Scan', ai: 'Smart Scan', both: 'Smart Scan' };
        toast.success(`${modeLabels[mode] || 'Scan'} started`);
      },
      onError: (err) => {
        toast.error((err instanceof Error ? err.message : String(err)));
      },
    });
  }, [startMutation]);

  const reset = useCallback(() => {
    setScan(null);
    setScanId(null);
    setClusters([]);
  }, []);

  const removeCluster = useCallback((id: string) => {
    setClusters(prev => prev.filter(c => c.id !== id));
  }, []);

  const isScanning = !!scan && scan.phase !== 'complete' && scan.phase !== 'error';

  return (
    <DedupeContext.Provider value={{
      startScan,
      scan,
      clusters,
      isScanning,
      isStarting: startMutation.isPending,
      reset,
      removeCluster,
    }}>
      {children}
    </DedupeContext.Provider>
  );
}

