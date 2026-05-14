// =============================================================================
// Dedupe Engine — Job Queue
// =============================================================================
// In-memory scan queue managing the dedupe scan lifecycle. Uses EventEmitter
// to push real-time progress updates to SSE clients.
//
// Mirrors the AI Search job queue pattern: fire-and-forget async processing
// with progress emitted per-phase. State is ephemeral (lost on restart).
//
// Concurrency: one scan at a time. Sequential passes within a scan.
// =============================================================================

import { EventEmitter } from "events";
import crypto from "crypto";
import { log } from "../../utils/logger.ts";
import type {
  DedupeScanMode,
  DedupeScanPhase,
  DedupeScanProgress,
  DedupeCluster,
  ClusterPair,
} from "./types.ts";

// =============================================================================
// Job Queue
// =============================================================================

/** Completed scans older than 30 minutes are garbage collected */
const GC_TTL_MS = 30 * 60 * 1000;

class DedupeJobQueue extends EventEmitter {
  private scans = new Map<string, DedupeScanProgress>();
  private processing = false;

  /** Check whether a new scan can be started. */
  canStartScan(): { allowed: boolean; reason?: string } {
    if (this.processing) {
      return {
        allowed: false,
        reason: "A dedupe scan is already in progress.",
      };
    }
    return { allowed: true };
  }

  /** Create a new scan entry and return it. */
  createScan(mode: DedupeScanMode): DedupeScanProgress {
    this.gc();

    const scanId = crypto.randomUUID();
    const scan: DedupeScanProgress = {
      scanId,
      mode,
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
      clustersFound: 0,
      totalPairs: 0,
      autoMerged: 0,
      pendingSuggestions: 0,
      clusters: [],
      startedAt: new Date().toISOString(),
    };

    this.scans.set(scanId, scan);
    log.info("DedupeQueue", `Scan ${scanId} created — mode: ${mode}`);
    return scan;
  }

  /** Get a scan by ID, or null if not found. */
  getScan(scanId: string): DedupeScanProgress | null {
    return this.scans.get(scanId) ?? null;
  }

  /** Get the currently active (in-progress) scan, or null if idle. */
  getActiveScan(): DedupeScanProgress | null {
    if (!this.processing) return null;
    for (const scan of this.scans.values()) {
      if (scan.phase !== "complete" && scan.phase !== "error") {
        return scan;
      }
    }
    return null;
  }

  /** Whether a scan is currently being processed. */
  isProcessing(): boolean {
    return this.processing;
  }

  /** Set processing lock — called by the service during scan execution. */
  setProcessing(value: boolean): void {
    this.processing = value;
  }

  /** Update scan state and emit to SSE listeners. */
  update(scanId: string, partial: Partial<DedupeScanProgress>): void {
    const scan = this.scans.get(scanId);
    if (!scan) return;
    Object.assign(scan, partial);
    this.emit(scanId, scan);
  }

  /** Mark scan as complete with final clusters. */
  complete(scanId: string, clusters: DedupeCluster[]): void {
    const scan = this.scans.get(scanId);
    if (!scan) return;
    scan.phase = "complete";
    scan.phaseName = "Scan complete";
    scan.clusters = clusters;
    scan.clustersFound = clusters.length;
    scan.completedAt = new Date().toISOString();
    this.processing = false;
    this.emit(scanId, scan);
    log.info(
      "DedupeQueue",
      `Scan ${scanId} complete — ${clusters.length} cluster(s)`,
    );
  }

  /** Mark scan as failed. */
  fail(scanId: string, error: string): void {
    const scan = this.scans.get(scanId);
    if (!scan) return;
    scan.phase = "error";
    scan.phaseName = "Scan failed";
    scan.error = error;
    scan.completedAt = new Date().toISOString();
    this.processing = false;
    this.emit(scanId, scan);
    log.error("DedupeQueue", `Scan ${scanId} failed — ${error}`);
  }

  /** Cleanup completed/failed scans older than GC_TTL_MS. */
  private gc(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, scan] of this.scans) {
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
}

// Singleton instance
export const dedupeQueue = new DedupeJobQueue();
