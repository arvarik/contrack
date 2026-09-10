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
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  useStartDedupeScan,
  useDedupeStream,
  fetchActiveScan,
  fetchScan,
} from "../api/dedupe";
import { toast } from "sonner";
import { rateLimitFacts } from "../api/client";
import type {
  DedupeScanMode,
  DedupeScanProgress,
  DedupeCluster,
} from "../types";

interface DedupeContextValue {
  startScan: (mode: DedupeScanMode, autoMergeThreshold?: number) => void;
  scan: DedupeScanProgress | null;
  /** Cluster-based results from the latest scan. */
  clusters: DedupeCluster[];
  isScanning: boolean;
  isStarting: boolean;
  /**
   * This account's scan is booked behind another account's, and has not
   * started. Nothing is progressing, so nothing progress-shaped is shown.
   */
  isQueued: boolean;
  reset: () => void;
  /** Remove a cluster from the local list (after merge or dismiss) */
  removeCluster: (id: string) => void;
}

const DedupeContext = createContext<DedupeContextValue | null>(null);

export function useDedupe() {
  const ctx = useContext(DedupeContext);
  if (!ctx) throw new Error("useDedupe must be used within DedupeProvider");
  return ctx;
}

/**
 * Failed polls in a row before the wait is abandoned.
 *
 * Ten at three seconds is half a minute. The server keeps the booked place
 * either way, so giving up early is worse than waiting: the pre-scan page
 * offers a button the server answers "a scan is already running for your
 * account".
 */
const QUEUE_POLL_MAX_FAILURES = 10;

export function DedupeProvider({ children }: { children: React.ReactNode }) {
  const [scan, setScan] = useState<DedupeScanProgress | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [clusters, setClusters] = useState<DedupeCluster[]>([]);
  // The run lock is global for 2.0, so one account at a time scans and the
  // rest wait. `queued` is that wait, and it is deliberately not a scan: the
  // scan record exists on the server but nothing is happening in it.
  const [queued, setQueued] = useState(false);
  // The id of the scan the server booked for us. Read only by the poll below,
  // to recover a scan that started and finished between two of its ticks.
  const queuedScanId = useRef<string | null>(null);
  const startMutation = useStartDedupeScan();

  // The mount-only recovery below must read the scanId AT RESOLVE TIME — a
  // scan the user starts while the fetch is in flight must win. Depending on
  // scanId would refire the fetch instead; a ref carries the live value into
  // the closure without re-running the effect.
  const liveScanId = useRef(scanId);
  useEffect(() => {
    liveScanId.current = scanId;
  }, [scanId]);

  // On mount, check if the server has an in-progress scan and recover state.
  // This handles page refresh during an active scan — without it, the user
  // would see the pre-scan page while the server is still processing.
  useEffect(() => {
    let cancelled = false;
    fetchActiveScan()
      .then((active) => {
        if (cancelled) return;
        // Only recover if we don't already have a scan in progress
        if (liveScanId.current) return;
        if (active.queued) {
          // A booked scan, not a running one. The poll below takes over and
          // attaches the stream once it actually starts.
          queuedScanId.current = active.scan?.scanId ?? null;
          setQueued(true);
          return;
        }
        if (active.scan) {
          setScan(active.scan);
          setScanId(active.scan.scanId);
        }
      })
      .catch(() => {
        // Nothing to recover, or the server refused. A refusal has already
        // been announced by the shared client, and this page has no better
        // answer than the pre-scan view it is already showing.
      });
    return () => {
      cancelled = true;
    };
  }, []); // Run once on mount only

  /**
   * While queued, ask every three seconds whether our turn has come.
   *
   * The stream is not an option here. A queued scan emits nothing until it
   * starts, the dedupe SSE has no heartbeat, and the client gives up after
   * three silent retries — so attaching it now would end with a connection
   * that closed itself before the scan began.
   *
   * Two answers mean the wait is over and they need different handling.
   * `active.scan` is our turn having started: adopt it and attach the stream.
   * No active scan at all means the scan ran *and finished* between two
   * ticks, because `getActiveScan` skips terminal scans — so the record is
   * fetched by id, which `GET /api/dedupe/status` still serves. Without that
   * a short scan simply vanished: the waiting card disappeared, the pre-scan
   * page came back, and the clusters it found were never shown.
   */
  useEffect(() => {
    if (!queued) return;
    let cancelled = false;
    let failures = 0;
    // Consecutive ticks that found nothing at all.
    let misses = 0;

    const adopt = (adopted: DedupeScanProgress) => {
      setQueued(false);
      setScan(adopted);
      setScanId(adopted.scanId);
      if (adopted.phase === "complete") setClusters(adopted.clusters ?? []);
    };

    const tick = async () => {
      try {
        const active = await fetchActiveScan();
        if (cancelled) return;
        failures = 0;
        if (active.queued) {
          // The queued record is where the scan id comes from. The 429 that
          // started this wait does not carry one.
          queuedScanId.current = active.scan?.scanId ?? queuedScanId.current;
          misses = 0;
          return; // still waiting
        }
        if (active.scan) {
          adopt(active.scan);
          return;
        }
        // Our turn came and went inside the gap. The id was remembered from
        // the first tick that saw the booked scan, precisely for this.
        const finishedId = queuedScanId.current;
        if (finishedId) {
          const finished = await fetchScan(finishedId);
          if (cancelled) return;
          if (finished) {
            adopt(finished);
            return;
          }
        }
        // Nothing queued, nothing running, nothing to recover. That is the
        // end of the wait — but not on one answer. The first tick fires
        // immediately after the 429, and a server that has not yet published
        // the booking would otherwise close a wait that had just opened.
        if (++misses >= 2) setQueued(false);
      } catch {
        if (cancelled) return;
        // The server still holds our place in line — only the connection is
        // failing. Dropping the wait would show the pre-scan page, and
        // pressing Begin Scan there is answered "a scan is already running
        // for your account", with no way back to the waiting state.
        // Ten ticks is half a minute before giving up.
        if (++failures >= QUEUE_POLL_MAX_FAILURES) setQueued(false);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [queued]);

  // SSE stream hook — updates scan state in real-time
  const handleUpdate = useCallback((updatedScan: DedupeScanProgress) => {
    setScan(updatedScan);
    // When complete, capture the final clusters
    if (updatedScan.phase === "complete") {
      setClusters(updatedScan.clusters ?? []);
    }
  }, []);

  useDedupeStream(scanId, handleUpdate);

  const startScan = useCallback(
    (mode: DedupeScanMode, autoMergeThreshold?: number) => {
      startMutation.mutate(
        { mode, autoMergeThreshold },
        {
          onSuccess: (result) => {
            // Set optimistic scan state BEFORE the SSE event arrives.
            // This prevents the pre-scan page from briefly flashing back during the
            // ~100-300ms gap between isStarting going false and the first SSE message.
            setScan({
              scanId: result.scanId,
              mode: result.mode,
              phase: "starting",
              phaseName: "Initializing scan…",
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
            setQueued(false);
            const modeLabels: Record<string, string> = {
              quick: "Quick Scan",
              deep: "Smart Scan",
              full: "Full Scan",
              deterministic: "Quick Scan",
              ai: "Smart Scan",
              both: "Smart Scan",
            };
            toast.success(`${modeLabels[mode] || "Scan"} started`);
          },
          onError: (err) => {
            // A 429 whose `details.yours` is false means another account
            // holds the run lock. The server has already created this
            // account's scan and booked its turn, so there is nothing to
            // retry and nothing has failed — which is why this is not an
            // error toast and why the view shows a waiting state rather than
            // a stalled progress bar.
            const facts = rateLimitFacts(err);
            if (facts && !facts.yours && facts.queued) {
              // The 429 does not name the scan the server just booked, so the
              // id comes from the next poll of `/dedupe/active`.
              queuedScanId.current = null;
              setQueued(true);
              toast("Another user's scan is running — yours is queued");
              return;
            }
            toast.error(err instanceof Error ? err.message : String(err));
          },
        },
      );
    },
    [startMutation],
  );

  const reset = useCallback(() => {
    setScan(null);
    setScanId(null);
    setClusters([]);
    setQueued(false);
    queuedScanId.current = null;
  }, []);

  const removeCluster = useCallback((id: string) => {
    setClusters((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const isScanning =
    !!scan && scan.phase !== "complete" && scan.phase !== "error";

  // Memoize the provider value to avoid forcing every consumer to re-render
  // when the DedupeProvider's parent re-renders for unrelated reasons.
  // The SSE stream fires frequently during a scan; without this memo any
  // ancestor change would create a new value reference and double-fire
  // consumers in addition to the real SSE updates.
  const value = useMemo(
    () => ({
      startScan,
      scan,
      clusters,
      isScanning,
      isStarting: startMutation.isPending,
      isQueued: queued,
      reset,
      removeCluster,
    }),
    [
      startScan,
      scan,
      clusters,
      isScanning,
      startMutation.isPending,
      queued,
      reset,
      removeCluster,
    ],
  );

  return (
    <DedupeContext.Provider value={value}>{children}</DedupeContext.Provider>
  );
}
