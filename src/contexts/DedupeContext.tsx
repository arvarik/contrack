/**
 * DedupeContext — Global state for the Dedupe Engine.
 *
 * Provides:
 * - startScan(mode): kicks off an async scan and connects SSE
 * - scan: current scan progress (live-updated via SSE)
 * - clusters: final cluster results when scan is complete
 * - suggestions: deprecated — always empty (kept for backward compat)
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
import type { DedupeScanMode, DedupeScanProgress, DedupeSuggestion, DedupeCluster } from '../types';

interface DedupeContextValue {
  startScan: (mode: DedupeScanMode) => void;
  scan: DedupeScanProgress | null;
  /** @deprecated Use `clusters` instead — always empty until removed. */
  suggestions: DedupeSuggestion[];
  /** Cluster-based results from the latest scan. */
  clusters: DedupeCluster[];
  isScanning: boolean;
  isStarting: boolean;
  reset: () => void;
  /** Remove a suggestion from the local list (after merge or dismiss) */
  removeSuggestion: (id: string) => void;
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
  const [suggestions, setSuggestions] = useState<DedupeSuggestion[]>([]);
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
    // When complete, capture the final clusters (and legacy suggestions for compat)
    if (updatedScan.phase === 'complete') {
      setClusters(updatedScan.clusters ?? []);
      setSuggestions(updatedScan.suggestions ?? []);
    }
  }, []);

  useDedupeStream(scanId, handleUpdate);

  const startScan = useCallback((mode: DedupeScanMode) => {
    startMutation.mutate(mode, {
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
          suggestions: [],
          clustersFound: 0,
          totalPairs: 0,
          clusters: [],
          startedAt: new Date().toISOString(),
        });
        setScanId(result.scanId);
        setSuggestions([]);
        setClusters([]);
        toast.success(`Dedupe scan started (${mode === 'both' ? 'full scan' : mode})`);
      },
      onError: (err) => {
        toast.error(err.message);
      },
    });
  }, [startMutation]);

  const reset = useCallback(() => {
    setScan(null);
    setScanId(null);
    setSuggestions([]);
    setClusters([]);
  }, []);

  const removeSuggestion = useCallback((id: string) => {
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }, []);

  const removeCluster = useCallback((id: string) => {
    setClusters(prev => prev.filter(c => c.id !== id));
  }, []);

  const isScanning = !!scan && scan.phase !== 'complete' && scan.phase !== 'error';

  return (
    <DedupeContext.Provider value={{
      startScan,
      scan,
      suggestions,
      clusters,
      isScanning,
      isStarting: startMutation.isPending,
      reset,
      removeSuggestion,
      removeCluster,
    }}>
      {children}
    </DedupeContext.Provider>
  );
}

