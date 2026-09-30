/**
 * AISearchContext — Global state for AI Search overlay.
 *
 * Provides:
 * - startSearch(contactIds, options?): kicks off a batch and opens the
 *   overlay, or adds the contacts to the batch already running, at the
 *   depth the caller names (Standard when it names none). Callers: the
 *   Enrichment settings page, for many contacts, and for one, "Enrich
 *   contact" and "Enrich deeply" in a contact's actions menu, and the
 *   dossier's Enrich contact and Enrich again menus.
 *
 * A start says nothing in a toast. The overlay opens at the same corner as
 * the toasts, and a success toast over it ("Enrichment started for 1
 * contact") said what the overlay already showed, and hid part of it.
 * - batch: current batch state (live-updated via SSE)
 * - isVisible: whether the overlay is showing
 * - depthFiguresApply: whether the depths' measured time and cost describe
 *   this instance's research, which they do only when Gemini runs it
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
  useRef,
} from "react";
import {
  useStartAISearch,
  useAISearchStream,
  useCancelAISearch,
} from "../api/aiSearch";
import { toast } from "sonner";
import { useAISettings } from "../api/aiSettings";
import { ApiError, rateLimitFacts } from "../api/client";
import { rateLimitMessage } from "../lib/rateLimitMessage";
import type { AISearchBatch } from "../types";
import type { ResearchDepth } from "../../shared/researchDepth";
import { AISearchProgressOverlay } from "../views/ai-search/components/AISearchProgressOverlay";

/** How one call to `startSearch` reports a limit. */
interface StartSearchOptions {
  /**
   * Where a limit is said: the enrichment lock held by another account.
   * `"page"`, the default, keeps it in `limitMessage` and shows no toast,
   * for a page that prints the message itself, as the Enrichment settings
   * page does. `"toast"` says it in a toast as well, for a control with no
   * page of its own to print it on: "Enrich contact" in the contact actions
   * menu closes as it is chosen, and without the toast a refused start said
   * nothing at all.
   */
  limitAs?: "page" | "toast";
  /** How thoroughly to research. Standard when absent. */
  depth?: ResearchDepth;
}

interface AISearchContextValue {
  startSearch: (contactIds: string[], options?: StartSearchOptions) => void;
  batch: AISearchBatch | null;
  isVisible: boolean;
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
  /**
   * Whether the depths' time and cost describe this instance's research.
   * They were measured on Gemini (shared/researchDepth.ts), so on another
   * provider the controls leave them out rather than show Gemini's figures
   * for a model the instance does not run.
   */
  depthFiguresApply: boolean;
}

const AISearchContext = createContext<AISearchContextValue | null>(null);

export function useAISearch() {
  const ctx = useContext(AISearchContext);
  if (!ctx) throw new Error("useAISearch must be used within AISearchProvider");
  return ctx;
}

/**
 * The AI Search context, or null outside its provider. For a part that also
 * renders on its own, like the dossier's Research card in a test: it offers
 * "Enrich again" only when there is a provider to start it.
 */
export function useOptionalAISearch(): AISearchContextValue | null {
  return useContext(AISearchContext);
}

/** The job states that mean research for a contact is still under way. */
const UNFINISHED = new Set(["queued", "searching", "merging"]);

/**
 * Whether this contact is being enriched: a start is on its way, or the
 * running batch still has an unfinished job for it. A control that starts
 * research waits while it is, so a second press cannot queue the contact
 * twice.
 */
export function isEnriching(
  search: Pick<AISearchContextValue, "isStarting" | "batch"> | null,
  contactId: string,
): boolean {
  return (
    !!search?.isStarting ||
    (search?.batch?.status === "processing" &&
      search.batch.jobs.some(
        (job) => job.contactId === contactId && UNFINISHED.has(job.status),
      ))
  );
}

export function AISearchProvider({ children }: { children: React.ReactNode }) {
  const [batch, setBatch] = useState<AISearchBatch | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const limitTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(limitTimer.current), []);
  // `mutate` is the one stable part of a mutation: the object around it is
  // new on every render, and a callback that closed over it changed with it.
  const { mutate: startMutate, isPending: isStarting } = useStartAISearch();
  const { data: aiSettings } = useAISettings();
  const depthFiguresApply =
    aiSettings?.capabilities?.research?.resolved?.providerId === "gemini";

  // SSE stream hook — updates batch state in real-time
  const handleUpdate = useCallback((updatedBatch: AISearchBatch) => {
    setBatch(updatedBatch);
  }, []);

  const stream = useAISearchStream(batchId, handleUpdate);
  const cancelMutation = useCancelAISearch();
  useEffect(() => {
    if (stream.error instanceof ApiError && stream.error.status === 404) {
      toast.error(
        "Research status is no longer available. The server may have restarted. Completed contact updates remain saved",
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
    (
      contactIds: string[],
      { limitAs = "page", depth }: StartSearchOptions = {},
    ) => {
      startMutate(
        { contactIds, depth },
        {
          onSuccess: (result) => {
            // A start that joined the running batch keeps the batch on screen:
            // the stream is already live, and it may have sent the longer job
            // list before this response arrived.
            if (!result.appended) setBatch(null);
            setBatchId(result.batchId);
            setIsVisible(true);
            setLimitMessage(null);
          },
          onError: (err) => {
            // A lock held by somebody else is not a failure, and
            // a red toast that vanishes is the wrong place for a wait the
            // reader has to act on. It is kept on the page instead, and the
            // toast is dropped for that case.
            const limited = rateLimitMessage(err, "enrichment");
            if (limited) {
              setLimitMessage(limited);
              // A caller with no page to print the message on asks for it in a
              // toast. An info toast, not an error: a wait is not a failure.
              if (limitAs === "toast") toast.info(limited);
              // The message names a wait, and the provider outlives the view
              // that shows it: the AI Search page unmounts on navigation, this
              // does not. Without an expiry, coming back an hour later reads a
              // countdown that ran out long ago. The stated wait, or a short
              // window when the server named none.
              const seconds = rateLimitFacts(err)?.retryAfterSeconds ?? 60;
              window.clearTimeout(limitTimer.current);
              limitTimer.current = window.setTimeout(
                () => setLimitMessage(null),
                seconds * 1000,
              );
              return;
            }
            setLimitMessage(null);
            toast.error(err instanceof Error ? err.message : String(err));
          },
        },
      );
    },
    [startMutate],
  );

  const clearLimit = useCallback(() => {
    window.clearTimeout(limitTimer.current);
    setLimitMessage(null);
  }, []);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    // Don't clear batch data — user might want to re-open
  }, []);

  // Memoize the provider value so an outer-tree re-render does NOT recreate
  // the object and force every `useAISearch()` consumer to re-render. The
  // identity of `value` now only changes when one of its observable fields
  // actually changes. `startSearch` keeps one identity for the provider's
  // life, because the only thing it closes over is the stable `mutate`.
  const value = useMemo(
    () => ({
      startSearch,
      batch,
      isVisible,
      isStarting,
      limitMessage,
      clearLimit,
      depthFiguresApply,
    }),
    [
      startSearch,
      batch,
      isVisible,
      isStarting,
      limitMessage,
      clearLimit,
      depthFiguresApply,
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
