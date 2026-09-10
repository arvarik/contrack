import { ApiError, apiFetch, apiJson } from "./client";
import { fetchAuthStatus } from "./auth";
import { emitAuthExpired } from "../lib/appEvents";
/**
 * Deduplication API Hooks — React Query hooks for the async duplicate detection engine.
 *
 * Provides:
 * - `useStartDedupeScan` — Kicks off a background scan with mode selection
 * - `useDedupeStream` — SSE hook for real-time scan progress
 * - `useMergeContacts` — Merge a single pair
 * - `useMergeBatch` — Bulk merge multiple pairs (list view)
 * - `useMergeCluster` — Merge an entire cluster into one contact
 * - `useMergeClusters` — Bulk merge multiple clusters
 * - `useSeedDuplicates` — Dev-only seed utility
 *
 * @module api/dedupe
 */
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Contact, DedupeScanMode, DedupeScanProgress } from "../types";
import { suggestionKeys } from "./suggestions";

const API_BASE = "/api";

// =============================================================================
// Start dedupe scan mutation
// =============================================================================

export const useStartDedupeScan = () => {
  return useMutation({
    mutationFn: async (opts: {
      mode: DedupeScanMode;
      autoMergeThreshold?: number;
    }) => {
      // `apiFetch` throws `ApiError` for any non-2xx, with the message read
      // out of the standard `{ error: { code, message } }` envelope, so the
      // caller's `onError` toast shows the server's own words. The busy 429
      // used to be the one endpoint here that answered with a bare
      // `{ error: string }`, which the block that used to sit below read by
      // hand; since 2e it sends the envelope like everything else and carries
      // `details.yours` and `details.queued` for Phase 4 to act on.
      const res = await apiFetch(`/dedupe/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: opts.mode,
          autoMergeThreshold: opts.autoMergeThreshold,
        }),
      });
      return res.json() as Promise<{ scanId: string; mode: DedupeScanMode }>;
    },
  });
};

// =============================================================================
// Active scan discovery (for state recovery after refresh)
// =============================================================================

/** What the server says about this account's scan right now. */
export interface ActiveScanState {
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
        // Merged data has to appear everywhere, not just on this page.
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
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
// Merge mutations
// =============================================================================

export const useMergeContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      primaryId,
      duplicateId,
    }: {
      primaryId: string;
      duplicateId: string;
    }) => {
      const res = await apiFetch(`/contacts/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, duplicateId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Merge failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};

export const useMergeBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      merges: { primaryId: string; duplicateId: string }[],
    ) => {
      const res = await apiFetch(`/contacts/merge-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merges }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Batch merge failed");
      }
      return res.json() as Promise<{
        results: {
          primaryId: string;
          duplicateId: string;
          success: boolean;
          error?: string;
        }[];
        succeeded: number;
        total: number;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};

// =============================================================================
// Cluster merge mutations
// =============================================================================

/**
 * Merge all duplicate contacts in a cluster into a single primary contact.
 * The server merges each duplicate sequentially and isolates per-duplicate errors.
 */
export const useMergeCluster = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      primaryId,
      duplicateIds,
    }: {
      primaryId: string;
      duplicateIds: string[];
    }) => {
      const res = await apiFetch(`/contacts/merge-cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, duplicateIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Cluster merge failed");
      }
      return res.json() as Promise<{
        success: boolean;
        merged: number;
        failed: number;
        contact: Contact;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      // The server resolves the pending suggestions this merge satisfied; the
      // review queue and its badge must drop them without a reload.
      queryClient.invalidateQueries({ queryKey: suggestionKeys.pending });
      queryClient.invalidateQueries({ queryKey: suggestionKeys.count });
      queryClient.invalidateQueries({ queryKey: suggestionKeys.mergeLog });
    },
  });
};

/**
 * Bulk merge multiple clusters in a single request.
 * Each cluster specifies a primaryId and an array of duplicateIds.
 */
export const useMergeClusters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      clusters: { primaryId: string; duplicateIds: string[] }[],
    ) => {
      const res = await apiFetch(`/contacts/merge-clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusters }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Batch cluster merge failed");
      }
      return res.json() as Promise<{
        results: { primaryId: string; merged: number; failed: number }[];
        totalMerged: number;
        totalFailed: number;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};

// =============================================================================
// Dev-only seed
// =============================================================================

export const useSeedDuplicates = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/dev/seed-duplicates`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to seed duplicates");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
};
