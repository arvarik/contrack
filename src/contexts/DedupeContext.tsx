/**
 * DedupeContext — Global state for the Dedupe Engine.
 *
 * Provides:
 * - startScan(mode): kicks off an async scan and connects SSE
 * - scan: current scan progress (live-updated via SSE)
 * - suggestions: final results when scan is complete
 * - isScanning: whether a scan is in progress
 * - reset(): clear state for a new scan
 *
 * State persists across route changes because this provider is mounted
 * at the App root, allowing the user to navigate away and return.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { useStartDedupeScan, useDedupeStream } from '../api/dedupe';
import { toast } from 'sonner';
import type { DedupeScanMode, DedupeScanProgress, DedupeSuggestion } from '../types';

interface DedupeContextValue {
  startScan: (mode: DedupeScanMode) => void;
  scan: DedupeScanProgress | null;
  suggestions: DedupeSuggestion[];
  isScanning: boolean;
  isStarting: boolean;
  reset: () => void;
  /** Remove a suggestion from the local list (after merge or dismiss) */
  removeSuggestion: (id: string) => void;
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
  const startMutation = useStartDedupeScan();

  // SSE stream hook — updates scan state in real-time
  const handleUpdate = useCallback((updatedScan: DedupeScanProgress) => {
    setScan(updatedScan);
    // When complete, capture the final suggestions
    if (updatedScan.phase === 'complete' && updatedScan.suggestions) {
      setSuggestions(updatedScan.suggestions);
    }
  }, []);

  useDedupeStream(scanId, handleUpdate);

  const startScan = useCallback((mode: DedupeScanMode) => {
    startMutation.mutate(mode, {
      onSuccess: (result) => {
        setScanId(result.scanId);
        setSuggestions([]);
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
  }, []);

  const removeSuggestion = useCallback((id: string) => {
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }, []);

  const isScanning = !!scan && scan.phase !== 'complete' && scan.phase !== 'error';

  return (
    <DedupeContext.Provider value={{
      startScan,
      scan,
      suggestions,
      isScanning,
      isStarting: startMutation.isPending,
      reset,
      removeSuggestion,
    }}>
      {children}
    </DedupeContext.Provider>
  );
}
