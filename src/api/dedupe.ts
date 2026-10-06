import { ApiError, apiFetch, apiJson, jsonBody } from "./client";
import { contactRoutes } from "../../shared/contracts/contacts";
import { fetchAuthStatus } from "./auth";
import { emitAuthExpired } from "../lib/appEvents";
import { corvidReact } from "../lib/corvid";
/**
 * Deduplication API Hooks — React Query hooks for the async duplicate detection engine.
 *
 * Provides:
 * - `useStartDedupeScan` — Starts a check for duplicates in the background
 * - `useDedupeStream` — SSE hook for real-time check progress
 * - `useMergeCluster` — Merge two or more contacts into one
 * - `useMergeClusters` — Merge several groups in one call
 *
 * Each merge answers with its merge-log ids, so the message after it can
 * offer Undo without reading Merge history.
 *
 * @module api/dedupe
 */
import { useEffect, useRef } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { DedupeScanMode, DedupeScanProgress } from "../types";
import { refreshDuplicates } from "./suggestions";

const API_BASE = "/api";

// =============================================================================
// Start dedupe scan mutation
// =============================================================================

export const useStartDedupeScan = () => {
  return useMutation({
    mutationFn: async (opts: { mode: DedupeScanMode }) => {
      // `apiFetch` throws `ApiError` for any non-2xx, with the message read
      // out of the standard `{ error: { code, message } }` envelope, so the
      // caller's `onError` toast shows the server's own words. The busy 429
      // used to be the one endpoint here that answered with a bare
      // `{ error: string }`, which the block that used to sit below read by
      // hand; since 2e it sends the envelope like everything else and carries
      // `details.yours` and `details.queued` for Phase 4 to act on.
      //
      // No threshold in the body. The server reads the account's sensitivity
      // preset for a scan exactly as it does for an import, so the browser
      // no longer carries a copy of the preset table that could disagree.
      const res = await apiFetch(`/dedupe/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: opts.mode }),
      });
      return res.json() as Promise<{ scanId: string; mode: DedupeScanMode }>;
    },
  });
};

// =============================================================================
// Active scan discovery (for state recovery after refresh)
// =============================================================================

/** What the server says about this account's scan right now. */
interface ActiveScanState {
  /** The scan record, whether it is running or only booked. */
  scan: DedupeScanProgress | null;
  /**
   * True when the scan exists but has not started, because another account
   * holds the global run lock.
   *
   * The distinction cannot be made from the scan record: a queued scan and a
   * scan that began a moment ago are both phase `starting`. Attaching the SSE
   * stream to a queued scan produces silence until the lock frees, which
   * looks exactly like a scan that has hung.
   */
  queued: boolean;
}

/**
 * What this account's scan is doing, if anything.
 *
 * This used to answer every failure with `null`, which reads as "idle". A
 * three-second poll built on that would spin forever against a 401. It now
 * throws like every other call, and both callers decide what to do.
 */
export async function fetchActiveScan(): Promise<ActiveScanState> {
  const data = await apiJson<{
    active?: boolean;
    queued?: boolean;
    scan?: DedupeScanProgress;
  }>(`/dedupe/active`);
  return {
    scan: data.active && data.scan ? data.scan : null,
    queued: data.queued === true,
  };
}

// =============================================================================
// SSE-based scan progress hook
// =============================================================================

/** Max SSE reconnection attempts before giving up */
const SSE_MAX_RETRIES = 3;
/** Delay between SSE reconnection attempts (ms) */
const SSE_RETRY_DELAY_MS = 2000;

/**
 * Failed polls in a row before the fallback gives up.
 *
 * Ten at three seconds is half a minute of silence. Long enough to ride out a
 * laptop lid, short enough that a tab left open on a dead server stops asking.
 */
const POLL_MAX_FAILURES = 10;

/**
 * One scan by id, or null when the server does not have it.
 *
 * Unlike `/dedupe/active` this serves a scan that has already finished, for
 * the thirty minutes before it is garbage-collected. That is what lets a
 * queued scan which started and completed between two polls still be shown
 * rather than silently disappearing.
 */
export async function fetchScan(
  scanId: string,
): Promise<DedupeScanProgress | null> {
  try {
    return await apiJson<DedupeScanProgress>(
      `/dedupe/status?scanId=${encodeURIComponent(scanId)}`,
    );
  } catch (error) {
    // A 404 is a scan that has aged out. Anything else has already been
    // announced by the shared client.
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Follow one scan to its end, by stream if possible and by polling if not.
 *
 * The stream is an `EventSource`, and an `EventSource` cannot report why it
 * failed: a network blip, a proxy timing out an idle connection, and a server
 * that has stopped accepting this browser's credential all arrive as the same
 * bare `error` event with no status and no body. So a failure is diagnosed
 * rather than guessed at.
 *
 * Three retries first, because most failures really are a blip. After that
 * `/api/auth/status` is asked the one question the stream cannot answer: is
 * this browser still signed in? If it is not, the gate is told and takes the
 * screen; the scan is somebody else's problem now. If it is, the scan is
 * still running and only the transport is broken, so progress comes from
 * `GET /api/dedupe/status` every three seconds until the scan ends.
 *
 * Before this, a stream that failed four times simply stopped. No error, no
 * toast, no state change — a progress bar that never moved again, for a scan
 * that finished normally.
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

    let retries = 0;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;
    let closed = false;

    /** Stop everything. Called on a terminal phase and on unmount. */
    function stop() {
      closed = true;
      source?.close();
      source = null;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    /** Hand one update up, and stop if the scan is over. */
    function deliver(scan: DedupeScanProgress) {
      onUpdateRef.current(scan);
      if (scan.phase === "complete" || scan.phase === "error") {
        // What the check merged and found has to appear everywhere: the
        // contacts, Possible duplicates, its count and Merge history.
        refreshDuplicates(queryClient, { contacts: true });
        stop();
      }
    }

    function startPolling() {
      if (closed || pollTimer !== null) return;
      let failures = 0;
      const tick = async () => {
        try {
          const scan = await apiJson<DedupeScanProgress>(
            `/dedupe/status?scanId=${encodeURIComponent(scanId!)}`,
          );
          failures = 0;
          if (!closed) deliver(scan);
        } catch (error) {
          if (closed) return;
          // A definite answer ends the wait. A 404 means the scan has been
          // garbage-collected, and a 401 or 403 has already reached the gate.
          const status = error instanceof ApiError ? error.status : 0;
          if (status === 404 || status === 401 || status === 403) {
            stop();
            return;
          }
          // Anything else is the connection, which is why polling started in
          // the first place: `diagnose` sends us here precisely when the
          // network looks broken. Stopping on the first failed tick would
          // have ended every scan that outlived a dropped packet, and the
          // comment promising recovery would never once have been true.
          if (++failures >= POLL_MAX_FAILURES) stop();
        }
      };
      pollTimer = window.setInterval(() => void tick(), 3000);
      void tick();
    }

    /** Decide what a dead stream means, then act on it. */
    async function diagnose() {
      try {
        const status = await fetchAuthStatus();
        const signedOut = status.authRequired && !status.authenticated;
        if (signedOut || status.user?.status === "disabled") {
          // The gate owns this. It puts up the right screen; a scan progress
          // card behind a sign-in form is not worth keeping alive.
          emitAuthExpired(
            status.user?.status === "disabled" ? "disabled" : "expired",
          );
          stop();
          return;
        }
      } catch {
        // The status call failed too, which points at the connection rather
        // than the credential. Poll: it is the same answer either way, and
        // polling recovers on its own when the network comes back.
      }
      startPolling();
    }

    function connect() {
      if (closed) return;
      source = new EventSource(`${API_BASE}/dedupe/stream?scanId=${scanId}`);

      source.onmessage = (event) => {
        try {
          const scan: DedupeScanProgress = JSON.parse(event.data);
          retries = 0; // a message means the transport is healthy again
          deliver(scan);
        } catch {
          // Ignore parse errors on individual events.
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        if (retries < SSE_MAX_RETRIES) {
          retries++;
          window.setTimeout(connect, SSE_RETRY_DELAY_MS);
          return;
        }
        void diagnose();
      };
    }

    connect();
    return stop;
  }, [scanId, queryClient]);
};

// =============================================================================
// Cluster merge mutations
// =============================================================================

/**
 * After a merge: the contacts reload, and Possible duplicates, its count,
 * the contact pages' banners and Merge history drop what the server
 * resolved.
 */
function afterClusterMerge(queryClient: QueryClient): void {
  // Two records made one: the corvid tidies its own feathers.
  corvidReact("preen");
  refreshDuplicates(queryClient, { contacts: true });
}

/**
 * Merge two or more contacts into the one kept. The server merges each of
 * the others in turn, and one that fails does not stop the rest.
 */
export const useMergeCluster = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      primaryId,
      duplicateIds,
    }: {
      primaryId: string;
      duplicateIds: string[];
    }) =>
      apiJson(
        contactRoutes.mergeCluster,
        `/contacts/merge-cluster`,
        jsonBody({ primaryId, duplicateIds }),
      ),
    onSuccess: () => afterClusterMerge(queryClient),
  });
};

/** Merge several groups in one request, each into the contact it keeps. */
export const useMergeClusters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clusters: { primaryId: string; duplicateIds: string[] }[]) =>
      apiJson(
        contactRoutes.mergeClusters,
        `/contacts/merge-clusters`,
        jsonBody({ clusters }),
      ),
    onSuccess: () => afterClusterMerge(queryClient),
  });
};
