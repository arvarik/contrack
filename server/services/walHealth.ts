// Write health: the WAL file, its checkpoints, and refused writes. In WAL mode
// every write goes to `curator.db-wal` first and a checkpoint folds it back;
// SQLite runs one by itself past a thousand pages. But an automatic checkpoint
// completes only when no reader still sees an older version, so one long reader
// (a dedupe scan, a full export) holds every checkpoint off and the WAL grows
// meanwhile, which a shared instance makes likely.
//
// Two numbers come out of here, for the admin health panel: the WAL's size, and
// how many requests were refused because the database was busy. The second is
// what people report ("it said try again"), and without a count one unlucky
// moment looks like a pattern.

import fs from "fs";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { jobQueue as aiSearchQueue } from "./aiSearch/jobQueue.ts";
import { dedupeQueue } from "./dedupe/jobQueue.ts";

/**
 * The size at which a passive checkpoint has clearly not been enough: 64 MB,
 * about sixteen thousand pages, sixteen times SQLite's own threshold, which
 * means checkpoints were blocked for a long time, not that the instance is
 * busy.
 */
export const WAL_TRUNCATE_BYTES = 64 * 1024 * 1024;

export interface CheckpointResult {
  at: string;
  mode: "passive" | "truncate";
  /** True when SQLite could not finish, which a reader is the usual cause of. */
  busy: boolean;
  /** Pages in the WAL when the checkpoint ran. */
  logPages: number;
  /** Pages it managed to move back into the database. */
  checkpointedPages: number;
  /** The WAL file size before and after, in bytes. */
  bytesBefore: number;
  bytesAfter: number;
}

export interface WriteHealth {
  /** The `-wal` file right now. */
  walBytes: number;
  /** The size at which the daily sweep stops asking nicely. */
  truncateAtBytes: number;
  /** The last checkpoint this process ran, or null when it has run none. */
  lastCheckpoint: CheckpointResult | null;
  /** Requests refused with a database-busy error since this process started. */
  busyErrors: number;
  /** When the last one of those happened. */
  lastBusyErrorAt: string | null;
  /** The window the counts cover. */
  startedAt: string;
}

const startedAt = new Date().toISOString();
let busyErrors = 0;
let lastBusyErrorAt: string | null = null;
let lastCheckpoint: CheckpointResult | null = null;

/**
 * One more request refused because the database was busy. Called from the error
 * middleware, the only place that knows a request was turned away rather than
 * retried inside better-sqlite3, whose recoveries nobody experienced.
 */
export function recordBusyError(): void {
  busyErrors += 1;
  lastBusyErrorAt = new Date().toISOString();
}

/** The write-ahead log's size in bytes, or 0 when there is no WAL file. */
export function walBytes(): number {
  try {
    return fs.statSync(`${sqlite.name}-wal`).size;
  } catch {
    // No file means no WAL, which is the state right after a truncate.
    return 0;
  }
}

/** Whether a long reader is running that a checkpoint would have to wait for. */
function longReaderRunning(): boolean {
  // A dedupe scan reads the whole corpus and a research batch reads and writes
  // for minutes: exactly the readers that keep a checkpoint from completing,
  // and a TRUNCATE waiting on one holds the write lock.
  return dedupeQueue.isProcessing() || aiSearchQueue.isProcessing();
}

/**
 * Fold the WAL back into the database. PASSIVE never waits: it moves what it
 * can and reports the rest, so it is safe on a schedule. TRUNCATE takes the
 * write lock and empties the file, which is what reclaims the disk, and is
 * worth it only when PASSIVE is clearly not keeping up.
 */
export function checkpoint(mode: "passive" | "truncate"): CheckpointResult {
  const bytesBefore = walBytes();
  const rows = sqlite.pragma(
    `wal_checkpoint(${mode === "truncate" ? "TRUNCATE" : "PASSIVE"})`,
  ) as { busy: number; log: number; checkpointed: number }[];
  const row = rows[0] ?? { busy: 1, log: -1, checkpointed: -1 };

  const result: CheckpointResult = {
    at: new Date().toISOString(),
    mode,
    busy: row.busy !== 0,
    logPages: row.log,
    checkpointedPages: row.checkpointed,
    bytesBefore,
    bytesAfter: walBytes(),
  };
  lastCheckpoint = result;
  return result;
}

/**
 * The checkpoint half of the daily sweep. PASSIVE first, because it costs
 * nothing and usually finishes. TRUNCATE only when the log is still over the
 * threshold and nothing long is reading, because a TRUNCATE behind a dedupe
 * scan would hold the write lock waiting for it, with every writer queued
 * behind. Never throws: the daily sweep is best effort.
 */
export function runWalMaintenance(
  // A parameter with a default, so a test can reach the truncating branch
  // without writing 64 MB; the daily sweep passes nothing.
  truncateAtBytes: number = WAL_TRUNCATE_BYTES,
): CheckpointResult | null {
  try {
    const passive = checkpoint("passive");

    if (passive.bytesAfter <= truncateAtBytes) {
      if (passive.busy) {
        log.debug(
          "Maintenance",
          `WAL checkpoint incomplete: ${passive.checkpointedPages}/${passive.logPages} pages, ${(passive.bytesAfter / 1e6).toFixed(1)} MB left`,
        );
      }
      return passive;
    }

    if (longReaderRunning()) {
      log.warn(
        "Maintenance",
        `The write-ahead log is ${(passive.bytesAfter / 1e6).toFixed(0)} MB and a scan is running, so it was left alone. ` +
          `A truncating checkpoint would hold the write lock until the scan finished.`,
      );
      return passive;
    }

    const truncated = checkpoint("truncate");
    log.info(
      "Maintenance",
      `The write-ahead log was ${(truncated.bytesBefore / 1e6).toFixed(0)} MB; ` +
        `a truncating checkpoint left it at ${(truncated.bytesAfter / 1e6).toFixed(1)} MB` +
        (truncated.busy
          ? " (SQLite reported busy, so it may be incomplete)"
          : ""),
    );
    return truncated;
  } catch (err) {
    log.warn("Maintenance", `WAL checkpoint failed: ${getErrorMessage(err)}`);
    return null;
  }
}

/** Everything the health panel reports about writing. */
export function writeHealth(): WriteHealth {
  return {
    walBytes: walBytes(),
    truncateAtBytes: WAL_TRUNCATE_BYTES,
    lastCheckpoint,
    busyErrors,
    lastBusyErrorAt,
    startedAt,
  };
}

/** Reset the counters. Tests only. */
export function __resetWriteHealth(): void {
  busyErrors = 0;
  lastBusyErrorAt = null;
  lastCheckpoint = null;
}
