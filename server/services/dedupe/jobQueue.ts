// The dedupe scan queue, in memory, pushing progress to SSE clients through an
// EventEmitter, like the research queue. State is lost on restart.
//
// One scan at a time for the whole instance. Each scan carries its account, so
// status and SSE are per owner, and accounts that arrive while the lock is held
// wait in a FIFO instead of being told to try later.

import { EventEmitter } from "events";
import crypto from "crypto";
import { log } from "../../utils/logger.ts";
import type { OwnerId, Scope } from "../../tenancy/scope.ts";
import type {
  DedupeScanMode,
  DedupeScanProgress,
  DedupeCluster,
} from "./types.ts";

// Job Queue

/** Completed scans older than 30 minutes are garbage collected */
const GC_TTL_MS = 30 * 60 * 1000;

/**
 * A scan and the account it runs for. The owner sits beside the progress
 * record, so `GET /api/dedupe/status` and the SSE stream send exactly the shape
 * the frontend parses.
 */
interface OwnedScan {
  scan: DedupeScanProgress;
  ownerId: OwnerId;
}

/**
 * A scan waiting for the global run lock. `start` is a closure the route
 * builds, so the queue never imports the dedupe engine, and it carries the
 * scope, so a scan that begins minutes later runs for the account that asked.
 */
interface PendingScan {
  ownerId: OwnerId;
  scanId: string;
  start: () => void;
}

class DedupeJobQueue extends EventEmitter {
  private scans = new Map<string, OwnedScan>();
  private processing = false;
  /** Owners waiting for the run lock, in the order they asked. */
  private pending: PendingScan[] = [];

  /**
   * Whether this account can start a scan now. The run lock is global: a scan
   * normalizes every contact the account owns and can call a provider per
   * candidate batch, so two at once would double the memory and halve the
   * shared quota. `yours` says which side refused, so the route can tell "you
   * are already scanning" from "somebody else is, and your turn is booked".
   */
  canStartScan(scope: Scope): {
    allowed: boolean;
    reason?: string;
    yours: boolean;
  } {
    if (this.processing) {
      const yours = this.hasActiveScan(scope);
      return {
        allowed: false,
        reason: yours
          ? "A dedupe scan is already running for your account."
          : "Another account's scan is running. Yours is queued.",
        yours,
      };
    }
    return { allowed: true, yours: true };
  }

  /** Create a new scan entry for this account and return it. */
  createScan(scope: Scope, mode: DedupeScanMode): DedupeScanProgress {
    this.gc();

    const scanId = crypto.randomUUID();
    const scan: DedupeScanProgress = {
      scanId,
      mode,
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
      clusters: [],
      startedAt: new Date().toISOString(),
    };

    this.scans.set(scanId, { scan, ownerId: scope.ownerId });
    log.info("DedupeQueue", `Scan ${scanId} created — mode: ${mode}`);
    return scan;
  }

  /**
   * Book this account's turn behind the running scan, one place per account.
   * False when it already holds one, so the route can say so.
   */
  enqueue(scope: Scope, scanId: string, start: () => void): boolean {
    if (this.pending.some((p) => p.ownerId === scope.ownerId)) return false;
    this.pending.push({ ownerId: scope.ownerId, scanId, start });
    log.info(
      "DedupeQueue",
      `Scan ${scanId} queued behind the running scan (${this.pending.length} waiting)`,
    );
    return true;
  }

  /** How many scans are waiting for the run lock. */
  queueLength(): number {
    return this.pending.length;
  }

  /**
   * Whether this account's scan is waiting for the lock rather than running.
   * `getActiveScan` cannot tell: a queued scan is a real record in phase
   * `starting`, like one that just began. The client needs the difference (a
   * progress bar, or "another account is scanning, yours is next"), and a
   * queued scan's SSE stream is silent until the lock frees. The 429 from `POST
   * /api/dedupe/scan` says `queued`, but a reload has no 429 to read.
   */
  isQueued(scope: Scope): boolean {
    return this.pending.some((p) => p.ownerId === scope.ownerId);
  }

  /**
   * One of this account's scans by id, or null. Another account's scan id gets
   * the same 404 as an id that never existed: a scan record holds every cluster
   * it found, with hydrated contacts, so a leaked id would read somebody else's
   * duplicate list.
   */
  getScan(scope: Scope, scanId: string): DedupeScanProgress | null {
    const owned = this.scans.get(scanId);
    if (!owned || owned.ownerId !== scope.ownerId) return null;
    return owned.scan;
  }

  /** This account's scan that is running or waiting, or null. */
  getActiveScan(scope: Scope): DedupeScanProgress | null {
    for (const owned of this.scans.values()) {
      if (owned.ownerId !== scope.ownerId) continue;
      if (owned.scan.phase !== "complete" && owned.scan.phase !== "error") {
        return owned.scan;
      }
    }
    return null;
  }

  /** Whether this account has a scan running or waiting. */
  hasActiveScan(scope: Scope): boolean {
    return this.getActiveScan(scope) !== null;
  }

  /** Whether the instance is running a scan, for anybody. */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Who is scanning and who is waiting, across the instance, for the admin
   * health panel only. Every other reader asks about one account, which is all
   * a member may know about.
   */
  instanceState(): { running: OwnerId | null; pending: OwnerId[] } {
    let running: OwnerId | null = null;
    if (this.processing) {
      for (const owned of this.scans.values()) {
        if (owned.scan.phase !== "complete" && owned.scan.phase !== "error") {
          running = owned.ownerId;
          break;
        }
      }
    }
    return { running, pending: this.pending.map((p) => p.ownerId) };
  }

  /** Set processing lock — called by the service during scan execution. */
  setProcessing(value: boolean): void {
    this.processing = value;
  }

  /** Update scan state and emit to SSE listeners. */
  update(scanId: string, partial: Partial<DedupeScanProgress>): void {
    const owned = this.scans.get(scanId);
    if (!owned) return;
    Object.assign(owned.scan, partial);
    this.emit(scanId, owned.scan);
  }

  /** Mark scan as complete with final clusters. */
  complete(scanId: string, clusters: DedupeCluster[]): void {
    const owned = this.scans.get(scanId);
    if (!owned) return;
    const { scan } = owned;
    scan.phase = "complete";
    scan.phaseName = "Done";
    scan.clusters = clusters;
    scan.clustersFound = clusters.length;
    scan.completedAt = new Date().toISOString();
    this.processing = false;
    this.emit(scanId, scan);
    log.info(
      "DedupeQueue",
      `Scan ${scanId} complete — ${clusters.length} cluster(s)`,
    );
    this.startNextPending();
  }

  /** Mark scan as failed. */
  fail(scanId: string, error: string): void {
    const owned = this.scans.get(scanId);
    if (!owned) return;
    const { scan } = owned;
    scan.phase = "error";
    scan.phaseName = "Failed";
    scan.error = error;
    scan.completedAt = new Date().toISOString();
    this.processing = false;
    this.emit(scanId, scan);
    log.error("DedupeQueue", `Scan ${scanId} failed — ${error}`);
    this.startNextPending();
  }

  /**
   * Hand the run lock to the account that has waited longest. Scheduled, not
   * called inline: `complete` runs inside the finishing scan, and starting the
   * next from there would run its synchronous prefix before the old scan
   * returned.
   */
  private startNextPending(): void {
    const next = this.pending.shift();
    if (!next) return;
    setImmediate(() => {
      if (this.processing) {
        // Somebody took the lock in between. Put this scan back at the front
        // rather than dropping it, so a queued turn is never lost.
        this.pending.unshift(next);
        return;
      }
      if (!this.scans.has(next.scanId)) return;
      log.info("DedupeQueue", `Starting queued scan ${next.scanId}`);
      next.start();
    });
  }

  /** Cleanup completed/failed scans older than GC_TTL_MS. */
  private gc(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, { scan }] of this.scans) {
      if (scan.phase === "complete" || scan.phase === "error") {
        const scanTime = new Date(scan.startedAt).getTime();
        if (now - scanTime > GC_TTL_MS) {
          this.scans.delete(id);
          this.removeAllListeners(id);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      log.debug("DedupeQueue", `GC: cleaned ${cleaned} stale scan(s)`);
    }
  }

  /** Reset queue state for tests. */
  __resetForTests(): void {
    this.scans.clear();
    this.pending = [];
    this.processing = false;
    this.removeAllListeners();
  }
}

// Singleton instance
export const dedupeQueue = new DedupeJobQueue();
