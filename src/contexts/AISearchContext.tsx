/**
 * App-wide state for AI research batches and their progress overlay.
 *
 * `startSearch` starts a batch, or adds contacts to the running one, at the
 * caller's depth (Standard by default) and with the engine research runs
 * (`runsEngine`, see `lib/aiFeatures`). A start shows no toast: the overlay
 * opens in the toasts' corner and says it already. The overlay renders
 * through a portal, above every route.
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
import {
  ENGINE_STRATEGY,
  engineFor,
  type WebSearchEngine,
} from "../../shared/webSearchEngine";
import { engineThatRuns } from "../lib/aiFeatures";
import { usePreferences } from "./PreferencesContext";
import { AISearchProgressOverlay } from "../views/ai-search/components/AISearchProgressOverlay";
import { errorText } from "../lib/utils";

/** How one call to `startSearch` reports a limit. */
interface StartSearchOptions {
  /**
   * Where a limit (another account's enrichment lock) is said. `"page"`, the
   * default, keeps it in `limitMessage` for a page that prints it. `"toast"`
   * also toasts it, for a control with no page, such as a menu item.
   */
  limitAs?: "page" | "toast";
  /** How thoroughly to research. Standard when absent. */
  depth?: ResearchDepth;
  /**
   * How to search, over the account's engine: the web search model's own
   * search, SearXNG alone, or both. The engine that runs when absent.
   */
  strategy?: "two-pass" | "searxng" | "combined";
}

interface AISearchContextValue {
  startSearch: (contactIds: string[], options?: StartSearchOptions) => void;
  batch: AISearchBatch | null;
  isVisible: boolean;
  isStarting: boolean;
  /**
   * Why the last start was refused, when a limit refused it. Kept here
   * because `handleConfirmStart` does not await the mutation. It may be the
   * reader's own limit or another account's lock.
   */
  limitMessage: string | null;
  /** Forget the message — the reader has seen it, or is trying again. */
  clearLimit: () => void;
  /**
   * Whether the depths' time and cost apply. They were measured on Gemini's
   * own search (shared/researchDepth.ts), so other engines leave them out.
   */
  depthFiguresApply: boolean;
  /** The web search model's provider, such as "Google Gemini", or null. */
  webSearchProvider: string | null;
  /** The engine this account chose: its own, or the instance's. */
  engine: WebSearchEngine;
  /**
   * The engine a start runs now: `engine`, or the one research gives way to
   * when it cannot run. Null when none can run, or before the settings load.
   */
  runsEngine: WebSearchEngine | null;
}

const AISearchContext = createContext<AISearchContextValue | null>(null);

export function useAISearch() {
  const ctx = useContext(AISearchContext);
  if (!ctx) throw new Error("useAISearch must be used within AISearchProvider");
  return ctx;
}

/**
 * The context, or null outside its provider, for a part that also renders
 * alone (the Research card offers "Enrich again" only with a provider).
 */
export function useOptionalAISearch(): AISearchContextValue | null {
  return useContext(AISearchContext);
}

/** The job states that mean research for a contact is still under way. */
const UNFINISHED = new Set(["queued", "searching", "merging"]);

/**
 * Whether a start for this contact is on its way or its job is unfinished,
 * so a second press cannot queue it twice.
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
  // `mutate` is stable. The mutation object around it is new each render.
  const { mutate: startMutate, isPending: isStarting } = useStartAISearch();
  const { data: aiSettings } = useAISettings();
  const { preferences } = usePreferences();
  const webSearchProvider =
    aiSettings?.capabilities?.research?.resolved?.providerLabel ?? null;
  const engine = engineFor(
    preferences.webSearchEngine,
    aiSettings?.webSearch.engine ?? "provider",
  );
  const runsEngine = aiSettings ? engineThatRuns(aiSettings, engine) : null;
  const depthFiguresApply =
    aiSettings?.capabilities?.research?.resolved?.providerId === "gemini" &&
    runsEngine === "provider";
  // Read at the start through a ref, so `startSearch` keeps one identity.
  // A start names the engine that runs, so the confirmation and the run
  // agree, and it never waits on a choice's save. With none that can run it
  // names none, and the server says what is missing.
  const startStrategy = useRef<
    (typeof ENGINE_STRATEGY)[WebSearchEngine] | undefined
  >(undefined);
  startStrategy.current = runsEngine ? ENGINE_STRATEGY[runsEngine] : undefined;

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
      { limitAs = "page", depth, strategy }: StartSearchOptions = {},
    ) => {
      startMutate(
        {
          contactIds,
          depth,
          strategy: strategy ?? startStrategy.current,
        },
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
            // Another account's lock is a wait, not a failure, so it stays
            // on the page instead of an error toast.
            const limited = rateLimitMessage(err, "enrichment");
            if (limited) {
              setLimitMessage(limited);
              // A caller with no page to print the message on asks for it in a
              // toast. An info toast, not an error: a wait is not a failure.
              if (limitAs === "toast") toast.info(limited);
              // The provider outlives the page, so the message expires with
              // the stated wait (a minute when none was named).
              const seconds = rateLimitFacts(err)?.retryAfterSeconds ?? 60;
              window.clearTimeout(limitTimer.current);
              limitTimer.current = window.setTimeout(
                () => setLimitMessage(null),
                seconds * 1000,
              );
              return;
            }
            setLimitMessage(null);
            toast.error(`Could not start the research: ${errorText(err)}`);
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

  // Memoized, so a parent's render does not redraw every consumer.
  const value = useMemo(
    () => ({
      startSearch,
      batch,
      isVisible,
      isStarting,
      limitMessage,
      clearLimit,
      depthFiguresApply,
      webSearchProvider,
      engine,
      runsEngine,
    }),
    [
      startSearch,
      batch,
      isVisible,
      isStarting,
      limitMessage,
      clearLimit,
      depthFiguresApply,
      webSearchProvider,
      engine,
      runsEngine,
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
