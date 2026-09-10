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
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import {
  useStartAISearch,
  useAISearchStream,
  useCancelAISearch,
} from "../api/aiSearch";
import { toast } from "sonner";
import { ApiError } from "../api/client";
import { rateLimitMessage } from "../lib/rateLimitMessage";
import type { AISearchBatch } from "../types";
import { AISearchProgressOverlay } from "../views/ai-search/components/AISearchProgressOverlay";

interface AISearchContextValue {
  startSearch: (contactIds: string[]) => void;
  batch: AISearchBatch | null;
  isVisible: boolean;
  dismiss: () => void;
  isStarting: boolean;
  /**
   * Why the last start was refused, when the reason was a limit rather than
   * a failure.
   *
   * The view cannot read it from the mutation: `handleConfirmStart` fires and
   * returns without awaiting, so the rejection lands here. Before 2.0 that
   * only ever meant "you did this too fast"; now it can also mean another
   * account holds the enrichment lock, which is not the reader's doing and
   * deserves different words.
   */
  limitMessage: string | null;
  /** Forget the message — the reader has seen it, or is trying again. */
  clearLimit: () => void;
}

const AISearchContext = createContext<AISearchContextValue | null>(null);

export function useAISearch() {
  const ctx = useContext(AISearchContext);
  if (!ctx) throw new Error("useAISearch must be used within AISearchProvider");
  return ctx;
}

export function AISearchProvider({ children }: { children: React.ReactNode }) {
  const [batch, setBatch] = useState<AISearchBatch | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const startMutation = useStartAISearch();

  // SSE stream hook — updates batch state in real-time
  const handleUpdate = useCallback((updatedBatch: AISearchBatch) => {
    setBatch(updatedBatch);
  }, []);

  const stream = useAISearchStream(batchId, handleUpdate);
  const cancelMutation = useCancelAISearch();
  useEffect(() => {
    if (stream.error instanceof ApiError && stream.error.status === 404) {
      toast.error(
        "Research status is no longer available. The server may have restarted. Completed contact updates remain saved.",
      );
      setBatchId(null);
      setBatch(null);
      setIsVisible(false);
    }
  }, [stream.error]);
  const cancel = () => {
    if (batchId)
      cancelMutation.mutate(batchId, {
        onError: (error) => toast.error(error.message),
      });
  };

  const startSearch = useCallback(
    (contactIds: string[]) => {
      startMutation.mutate(contactIds, {
        onSuccess: (result) => {
          setBatch(null);
          setBatchId(result.batchId);
          setIsVisible(true);
          setLimitMessage(null);
          toast.success(
            `AI Search started for ${result.jobCount} contact${result.jobCount !== 1 ? "s" : ""}`,
          );
        },
        onError: (err) => {
          // A cooldown or a lock held by somebody else is not a failure, and
          // a red toast that vanishes is the wrong place for a wait the
          // reader has to act on. It is kept on the page instead, and the
          // toast is dropped for that case.
          const limited = rateLimitMessage(err, "enrichment");
          if (limited) {
            setLimitMessage(limited);
            return;
          }
          setLimitMessage(null);
          toast.error(err instanceof Error ? err.message : String(err));
        },
      });
    },
    [startMutation],
  );

  const clearLimit = useCallback(() => setLimitMessage(null), []);

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
      limitMessage,
      clearLimit,
    }),
    [
      startSearch,
      batch,
      isVisible,
      dismiss,
      startMutation.isPending,
      limitMessage,
      clearLimit,
    ],
  );

  return (
    <AISearchContext.Provider value={value}>
      {children}
      {/* Progress overlay rendered via portal-like positioning at root level */}
      {isVisible && batch && (
        <AISearchProgressOverlay
          key={batch.id}
          batch={batch}
          onDismiss={dismiss}
          onCancel={cancel}
          isCancelling={cancelMutation.isPending}
          connectionError={!!stream.error}
        />
      )}
    </AISearchContext.Provider>
  );
}
