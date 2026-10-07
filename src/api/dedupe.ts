/**
 * Hooks for the background duplicate check and for merges. Each merge
 * answers with its merge-log ids, so the message after it can offer Undo.
 */
import { ApiError, apiFetch, apiJson, jsonBody } from "./client";
import { contactRoutes } from "../../shared/contracts/contacts";
import { fetchAuthStatus } from "./auth";
import { emitAuthExpired } from "../lib/appEvents";
import { corvidReact } from "../lib/corvid";
import { useEffect, useRef } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { DedupeScanMode, DedupeScanProgress } from "../types";
import { refreshDuplicates } from "./suggestions";

const API_BASE = "/api";

// Start a scan

export const useStartDedupeScan = () => {
  return useMutation({
    mutationFn: async (opts: { mode: DedupeScanMode }) => {
      // No threshold in the body: the server reads the account's preset, as
      // it does for an import. A busy 429 carries `details.yours` and
      // `details.queued` (see `rateLimitFacts`).
      const res = await apiFetch(`/dedupe/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: opts.mode }),
      });
      return res.json() as Promise<{ scanId: string; mode: DedupeScanMode }>;
    },
  });
};

// The active scan, for recovery after a reload

/** What the server says about this account's scan right now. */
interface ActiveScanState {
  /** The scan record, whether it is running or only booked. */
  scan: DedupeScanProgress | null;
  /**
   * True when the scan waits for another account's run lock. The record
   * cannot tell: a queued scan and a new one are both phase `starting`, and
   * a stream on a queued scan is silent, like a hung one.
   */
  queued: boolean;
}

/**
 * What this account's scan is doing, if anything. A failure throws rather
 * than reading as idle, or a poll would spin forever against a 401.
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

// Scan progress

/** Max SSE reconnection attempts before giving up */
const SSE_MAX_RETRIES = 3;
/** Delay between SSE reconnection attempts (ms) */
const SSE_RETRY_DELAY_MS = 2000;

/**
 * Failed polls in a row before the fallback gives up: half a minute, enough
 * for a laptop lid, short enough that a tab on a dead server stops asking.
 */
const POLL_MAX_FAILURES = 10;

/**
 * One scan by id, or null when the server does not have it. Unlike
 * `/dedupe/active` it serves a finished scan for thirty minutes, so a queued
 * scan that ran between two polls still shows.
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
 * Follows one scan to its end, by stream if possible and by polling if not.
 *
 * An `EventSource` cannot say why it failed: a blip, a proxy timeout and a
 * rejected credential are the same bare `error` event. So after three
 * retries `/api/auth/status` says whether this browser is still signed in.
 * If not, the gate takes the screen. If so, only the transport is broken,
 * and `GET /api/dedupe/status` is polled every three seconds until the end.
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
          // A definite answer ends the wait: a 404 is a collected scan, and a
          // 401 or 403 has reached the gate.
          const status = error instanceof ApiError ? error.status : 0;
          if (status === 404 || status === 401 || status === 403) {
            stop();
            return;
          }
          // Anything else is the connection, the reason polling started, so
          // one failed tick does not stop it.
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
          // The gate puts up the right screen. The scan card can go.
          emitAuthExpired(
            status.user?.status === "disabled" ? "disabled" : "expired",
          );
          stop();
          return;
        }
      } catch {
        // The status call failed too: the connection, not the credential.
        // Polling recovers on its own when the network comes back.
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

// Merges

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
