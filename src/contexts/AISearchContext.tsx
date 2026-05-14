/**
 * AISearchContext — Global state for AI Search overlay.
 *
 * Provides:
 * - startSearch(contactIds): kicks off a batch and opens the overlay
 * - batch: current batch state (live-updated via SSE)
 * - isVisible: whether the overlay is showing
 * - dismiss(): close the overlay entirely
 *
 * The AISearchProgressOverlay is rendered via portal from this provider,
 * so it floats above all content regardless of routing.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useStartAISearch, useAISearchStream } from '../api/aiSearch';
import { toast } from 'sonner';
import type { AISearchBatch } from '../types';
import { AISearchProgressOverlay } from '../views/ai-search/components/AISearchProgressOverlay';

interface AISearchContextValue {
  startSearch: (contactIds: string[]) => void;
  batch: AISearchBatch | null;
  isVisible: boolean;
  dismiss: () => void;
  isStarting: boolean;
}

const AISearchContext = createContext<AISearchContextValue | null>(null);

export function useAISearch() {
  const ctx = useContext(AISearchContext);
  if (!ctx) throw new Error('useAISearch must be used within AISearchProvider');
  return ctx;
}

export function AISearchProvider({ children }: { children: React.ReactNode }) {
  const [batch, setBatch] = useState<AISearchBatch | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const startMutation = useStartAISearch();

  // SSE stream hook — updates batch state in real-time
  const handleUpdate = useCallback((updatedBatch: AISearchBatch) => {
    setBatch(updatedBatch);
  }, []);

  useAISearchStream(batchId, handleUpdate);

  const startSearch = useCallback((contactIds: string[]) => {
    startMutation.mutate(contactIds, {
      onSuccess: (result) => {
        setBatchId(result.batchId);
        setIsVisible(true);
        toast.success(`AI Search started for ${result.jobCount} contact${result.jobCount !== 1 ? 's' : ''}`);
      },
      onError: (err) => {
        toast.error((err instanceof Error ? err.message : String(err)));
      },
    });
  }, [startMutation]);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    // Don't clear batch data — user might want to re-open
  }, []);

  // Memoize the provider value so an outer-tree re-render does NOT recreate
  // the object and force every `useAISearch()` consumer to re-render. The
  // identity of `value` now only changes when one of its observable fields
  // actually changes.
  const value = useMemo(
    () => ({
      startSearch,
      batch,
      isVisible,
      dismiss,
      isStarting: startMutation.isPending,
    }),
    [startSearch, batch, isVisible, dismiss, startMutation.isPending],
  );

  return (
    <AISearchContext.Provider value={value}>
      {children}
      {/* Progress overlay rendered via portal-like positioning at root level */}
      {isVisible && batch && (
        <AISearchProgressOverlay batch={batch} onDismiss={dismiss} />
      )}
    </AISearchContext.Provider>
  );
}
