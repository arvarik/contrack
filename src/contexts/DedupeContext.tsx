/**
 * App-wide state for a check for duplicates: its progress, and its counts
 * once done. What a check finds lives on the server, in Possible duplicates.
 * On mount it reattaches to a scan that is still running, after a reload.
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
import type { DedupeScanMode, DedupeScanProgress } from "../types";
import { errorText } from "../lib/utils";

interface DedupeContextValue {
  startScan: (mode: DedupeScanMode) => void;
  scan: DedupeScanProgress | null;
  isScanning: boolean;
  isStarting: boolean;
  /**
   * This account's scan is booked behind another account's, and has not
   * started. Nothing is progressing, so nothing progress-shaped is shown.
   */
  isQueued: boolean;
  reset: () => void;
}

const DedupeContext = createContext<DedupeContextValue | null>(null);

export function useDedupe() {
  const ctx = useContext(DedupeContext);
  if (!ctx) throw new Error("useDedupe must be used within DedupeProvider");
  return ctx;
}

/**
 * Failed polls in a row (half a minute) before the wait is abandoned. The
 * server keeps the booked place either way, and the pre-scan page's button
 * would be refused.
 */
const QUEUE_POLL_MAX_FAILURES = 10;

export function DedupeProvider({ children }: { children: React.ReactNode }) {
  const [scan, setScan] = useState<DedupeScanProgress | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  // The run lock is global, so one account scans at a time. `queued` is the
  // wait, and not a scan: its record exists but nothing runs in it.
  const [queued, setQueued] = useState(false);
  // The booked scan's id, for a scan that runs between two poll ticks.
  const queuedScanId = useRef<string | null>(null);
  const startMutation = useStartDedupeScan();

  // The mount-only recovery reads the scanId when it resolves, so a scan
  // started while the fetch is in flight wins.
  const liveScanId = useRef(scanId);
  useEffect(() => {
    liveScanId.current = scanId;
  }, [scanId]);

  // On mount, recover a scan the server is still running.
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
        // Nothing to recover, or a refusal the shared client announced.
      });
    return () => {
      cancelled = true;
    };
  }, []); // Run once on mount only

  /**
   * While queued, polls every three seconds. Not the stream: a queued scan
   * sends nothing, and the stream gives up after three silent retries.
   *
   * `active.scan` means the turn started: adopt it and attach the stream. No
   * active scan means it ran and finished between ticks (`getActiveScan`
   * skips finished scans), so the record is fetched by id.
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
    };

    const tick = async () => {
      try {
        const active = await fetchActiveScan();
        if (cancelled) return;
        failures = 0;
        if (active.queued) {
          // The 429 that started the wait carries no scan id. This does.
          queuedScanId.current = active.scan?.scanId ?? queuedScanId.current;
          misses = 0;
          return; // still waiting
        }
        if (active.scan) {
          adopt(active.scan);
          return;
        }
        // The turn came and went between ticks.
        const finishedId = queuedScanId.current;
        if (finishedId) {
          const finished = await fetchScan(finishedId);
          if (cancelled) return;
          if (finished) {
            adopt(finished);
            return;
          }
        }
        // Nothing queued or running ends the wait, but not on one answer:
        // the first tick can beat the server's booking.
        if (++misses >= 2) setQueued(false);
      } catch {
        if (cancelled) return;
        // Only the connection fails, and the server still holds the place.
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
  }, []);

  useDedupeStream(scanId, handleUpdate);

  const startScan = useCallback(
    (mode: DedupeScanMode) => {
      startMutation.mutate(
        { mode },
        {
          onSuccess: (result) => {
            // Set before the first event, so the pre-scan page does not flash
            // back in the gap after `isStarting` goes false.
            setScan({
              scanId: result.scanId,
              mode: result.mode,
              phase: "starting",
              phaseName: "Starting",
              contactsScanned: 0,
              totalContacts: 0,
              deterministicFound: 0,
              aiCandidatesFound: 0,
              aiEvaluated: 0,
              blockingCandidates: 0,
              scoringAutoMerge: 0,
              scoringAiQueue: 0,
              scoringDiscarded: 0,
              clustersFound: 0,
              totalPairs: 0,
              autoMerged: 0,
              pendingSuggestions: 0,
              startedAt: new Date().toISOString(),
            });
            setScanId(result.scanId);
            setQueued(false);
          },
          onError: (err) => {
            // `details.yours` false: another account holds the run lock, and
            // the server has booked this scan's turn. A wait, not an error.
            const facts = rateLimitFacts(err);
            if (facts && !facts.yours && facts.queued) {
              // The id comes from the next poll of `/dedupe/active`.
              queuedScanId.current = null;
              setQueued(true);
              toast(
                "Another account is checking for duplicates. Yours starts after it",
              );
              return;
            }
            toast.error(`Could not check for duplicates: ${errorText(err)}`);
          },
        },
      );
    },
    [startMutation],
  );

  const reset = useCallback(() => {
    setScan(null);
    setScanId(null);
    setQueued(false);
    queuedScanId.current = null;
  }, []);

  const isScanning =
    !!scan && scan.phase !== "complete" && scan.phase !== "error";

  // Memoized, so a parent's render does not redraw every consumer.
  const value = useMemo(
    () => ({
      startScan,
      scan,
      isScanning,
      isStarting: startMutation.isPending,
      isQueued: queued,
      reset,
    }),
    [startScan, scan, isScanning, startMutation.isPending, queued, reset],
  );

  return (
    <DedupeContext.Provider value={value}>{children}</DedupeContext.Provider>
  );
}
