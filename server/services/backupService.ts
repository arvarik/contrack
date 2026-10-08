// Scheduled SQLite snapshots, verified and rotated. better-sqlite3's online
// backup API (safe while the database is in use, WAL included) copies
// curator.db into DATA_DIR/backups/, so a bad bulk operation or a disk failure
// is annoying instead of catastrophic. Every snapshot is opened again as soon
// as it is written: a backup nobody has opened is a hope.
//
// Config (env):
//   BACKUP_INTERVAL_HOURS: schedule cadence (default 24; 0 turns it off)
//   BACKUP_KEEP:           rotation depth (default 7 most recent)
//
// The schedule is two jobs (server/jobs/backups.ts): the startup snapshot 15
// seconds after boot, and the scheduled backup every interval. The interval is
// a setting, and `rescheduleBackups` moves the next run when it changes.

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { OWNED_TABLES, sqlite } from "../db.ts";
import { DATA_DIR, ensureDir } from "../utils/paths.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { backupIntervalHours, backupKeep } from "./lifecycleSettings.ts";
import { nextRunOf, scheduleNextRun } from "../jobs/runner.ts";

export const BACKUPS_DIR = path.join(DATA_DIR, "backups");

/**
 * The tables a snapshot is counted against: the owned tables plus `users`,
 * which hold every row somebody would hate to lose. A snapshot that reads
 * cleanly and holds none of them is the failure this check exists for.
 */
const COUNTED_TABLES = [...OWNED_TABLES, "users"] as const;

/** What opening a snapshot and looking inside it found. */
export interface BackupVerification {
  /** The snapshot opened, passed its integrity check, and holds the data. */
  ok: boolean;
  checkedAt: string;
  /** What `PRAGMA quick_check` answered. "ok" when the file is sound. */
  integrity: string;
  /** Row counts inside the snapshot. */
  rows: Record<string, number>;
  /** The same counts in the live database when the check ran. */
  liveRows: Record<string, number>;
  /** Why `ok` is false. Absent when it is true. */
  problem?: string;
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  /**
   * Null for a snapshot with no sidecar (an older one, or one whose sidecar was
   * removed). Not the same as a failed check, and the view says so.
   */
  verification: BackupVerification | null;
}

/** Where a snapshot's verification is recorded: beside it, same name, .json. */
function sidecarPath(file: string): string {
  return `${file}.json`;
}

/** Count the rows in one table, or null when the table is not there at all. */
function countRows(db: Database.Database, table: string): number | null {
  try {
    // The table names are the module constant above, never anything a caller
    // supplies, which is why they can be interpolated at all.
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    return row.n;
  } catch {
    return null;
  }
}

/**
 * Open a snapshot and decide whether it is a backup or just a file. Three
 * things can be wrong, each quieter than the last:
 *
 * 1. The file does not open. A truncated or corrupted snapshot throws here, so
 *    the open is inside the same try.
 * 2. `PRAGMA quick_check` reports damage. It reads every page and index.
 * 3. The file is sound and empty: a snapshot of the wrong moment or database
 *    reads perfectly and restores nothing. A table with rows in the live
 *    database and none in the snapshot fails the check.
 *
 * sqlite-vec is not loaded on purpose: nothing counted is a virtual table,
 * `quick_check` reads the vec0 shadow tables as ordinary pages, and an
 * extension in a file of unknown soundness is one more way to crash.
 */
export function verifyBackup(file: string): BackupVerification {
  const checkedAt = new Date().toISOString();
  const rows: Record<string, number> = {};
  const liveRows: Record<string, number> = {};

  for (const table of COUNTED_TABLES) {
    liveRows[table] = countRows(sqlite, table) ?? 0;
  }

  // Opening a snapshot creates its WAL companions, even read only, because it
  // was copied from a WAL-mode database. A read-only connection cannot remove
  // them when it closes, so without this every verified snapshot would leave a
  // 32 KB `-shm` and an empty `-wal` that rotation never removes. Only what
  // this open created is removed; a companion already there belongs to somebody
  // else.
  const companions = [`${file}-shm`, `${file}-wal`].filter(
    (companion) => !fs.existsSync(companion),
  );

  let snapshot: Database.Database | null = null;
  try {
    snapshot = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = String(
      snapshot.pragma("quick_check", { simple: true }) ?? "unknown",
    );

    const missing: string[] = [];
    const empty: string[] = [];
    for (const table of COUNTED_TABLES) {
      const count = countRows(snapshot, table);
      if (count === null) {
        missing.push(table);
        continue;
      }
      rows[table] = count;
      if (count === 0 && liveRows[table] > 0) empty.push(table);
    }

    let problem: string | undefined;
    if (integrity !== "ok") problem = `Integrity check: ${integrity}`;
    else if (missing.length > 0)
      problem = `Missing table(s): ${missing.join(", ")}`;
    else if (empty.length > 0)
      problem = `Empty in the snapshot but not in the database: ${empty.join(", ")}`;

    return {
      ok: !problem,
      checkedAt,
      integrity,
      rows,
      liveRows,
      ...(problem ? { problem } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      checkedAt,
      integrity: "unreadable",
      rows,
      liveRows,
      problem: `Could not read the snapshot: ${getErrorMessage(err)}`,
    };
  } finally {
    snapshot?.close();
    for (const companion of companions) {
      // A read-only connection cannot write the `-wal`, and the size check
      // makes that a fact: removing a WAL with anything in it would take the
      // snapshot's newest pages with it.
      try {
        if (fs.existsSync(companion) && fs.statSync(companion).size === 0) {
          fs.rmSync(companion, { force: true });
        } else if (fs.existsSync(companion) && companion.endsWith("-shm")) {
          fs.rmSync(companion, { force: true });
        }
      } catch {
        // Litter is not worth failing a verification over.
      }
    }
  }
}

/** Read a snapshot's recorded verification, or null when it has none. */
function readVerification(file: string): BackupVerification | null {
  try {
    return JSON.parse(
      fs.readFileSync(sidecarPath(file), "utf8"),
    ) as BackupVerification;
  } catch {
    return null;
  }
}

function keepCount(): number {
  return backupKeep().value;
}

/** List existing backups, newest first. */
export function listBackups(): BackupInfo[] {
  ensureDir(BACKUPS_DIR);
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith("curator-") && f.endsWith(".db"))
    .map((filename) => {
      const file = path.join(BACKUPS_DIR, filename);
      const stat = fs.statSync(file);
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        verification: readVerification(file),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The file of a listed snapshot, for a download. Null for any other name, so
 * a name with a path in it, a partial file or a sidecar is never served.
 */
export function snapshotFile(filename: string): string | null {
  return listBackups().some((backup) => backup.filename === filename)
    ? path.join(BACKUPS_DIR, filename)
    : null;
}

/** Delete backups beyond the rotation depth (oldest first). */
function rotateBackups(): void {
  const excess = listBackups().slice(keepCount());
  for (const backup of excess) {
    try {
      const file = path.join(BACKUPS_DIR, backup.filename);
      fs.unlinkSync(file);
      // The sidecar goes with its snapshot, or the next file to take that name
      // would adopt a stale verification (a timestamped name repeats only when
      // the clock goes backwards).
      fs.rmSync(sidecarPath(file), { force: true });
      // Anything a verification left beside an older snapshot goes with it.
      fs.rmSync(`${file}-shm`, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      log.info("Backup", `Rotated out old backup ${backup.filename}`);
    } catch (err) {
      log.warn(
        "Backup",
        `Failed to rotate ${backup.filename}: ${getErrorMessage(err)}`,
      );
    }
  }
}

let activeBackupPromise: Promise<BackupInfo> | null = null;

/** The suffix of a snapshot that is still being written. */
const PARTIAL = ".partial";

/**
 * Remove what an earlier snapshot left half written. Only one snapshot runs
 * at a time, so a partial file found before one starts is from a process
 * that stopped during its copy.
 */
function removePartials(): void {
  for (const name of fs.readdirSync(BACKUPS_DIR)) {
    if (name.startsWith("curator-") && name.endsWith(PARTIAL)) {
      fs.rmSync(path.join(BACKUPS_DIR, name), { force: true });
    }
  }
}

/**
 * Take a snapshot now with the online backup API: consistent with concurrent
 * writers, and incremental, so the event loop is not blocked.
 */
export async function runBackup(): Promise<BackupInfo> {
  if (activeBackupPromise) {
    log.info("Backup", "Backup already in progress; attaching to active run");
    return activeBackupPromise;
  }

  activeBackupPromise = (async () => {
    try {
      ensureDir(BACKUPS_DIR);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `curator-${stamp}.db`;
      const dest = path.join(BACKUPS_DIR, filename);
      // Written under a name the listing does not read, and renamed once whole
      // and checked, so a stop during the copy never leaves a partial file as
      // the newest snapshot, the one a restore reaches for first.
      const partial = `${dest}${PARTIAL}`;
      removePartials();

      const startMs = Date.now();
      let stat: fs.Stats;
      let verification: BackupVerification;
      try {
        await sqlite.backup(partial);
        stat = fs.statSync(partial);
        // Checked at once, while the snapshot can still be taken again.
        verification = verifyBackup(partial);
        fs.renameSync(partial, dest);
      } catch (err) {
        fs.rmSync(partial, { force: true });
        throw err;
      }
      const writtenMs = Date.now() - startMs;
      try {
        fs.writeFileSync(
          sidecarPath(dest),
          JSON.stringify(verification, null, 2),
        );
      } catch (err) {
        log.warn(
          "Backup",
          `Could not record the verification for ${filename}: ${getErrorMessage(err)}`,
        );
      }

      const size = `${(stat.size / 1024 / 1024).toFixed(2)} MB`;
      if (verification.ok) {
        log.info(
          "Backup",
          `Snapshot ${filename} written and verified (${size} in ${writtenMs}ms, checked in ${Date.now() - startMs - writtenMs}ms)`,
        );
      } else {
        // An error, not a warning. A snapshot that cannot be read is not a
        // degraded backup, it is no backup, and the operator is relying on it.
        log.error(
          "Backup",
          `Snapshot ${filename} FAILED VERIFICATION (${size}): ${verification.problem}`,
        );
      }

      rotateBackups();
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        verification,
      };
    } finally {
      activeBackupPromise = null;
    }
  })();

  return activeBackupPromise;
}

/**
 * Warn at boot when the newest verified snapshot is more than two intervals
 * old: one missed snapshot is a restart at the wrong moment, two is a schedule
 * that stopped. The log line is where an operator finds out that the backups
 * they think they have stopped some time ago.
 */
function warnAboutStaleBackups(intervalHours: number): void {
  const verified = listBackups().filter((b) => b.verification?.ok);
  if (verified.length === 0) {
    const total = listBackups().length;
    log.warn(
      "Backup",
      total === 0
        ? "No snapshots exist yet. The first one is taken shortly after boot."
        : `None of the ${total} existing snapshot(s) has passed verification. Check the backups directory.`,
    );
    return;
  }

  const newest = verified[0];
  const ageHours =
    (Date.now() - new Date(newest.createdAt).getTime()) / 3_600_000;
  if (ageHours > intervalHours * 2) {
    log.warn(
      "Backup",
      `The newest verified snapshot (${newest.filename}) is ${Math.floor(ageHours)}h old, ` +
        `more than two ${intervalHours}h intervals. Scheduled backups may have stopped.`,
    );
  }
}

/** The job kind of the scheduled backup (server/jobs/backups.ts). */
export const SCHEDULED_BACKUP_JOB = "backup.scheduled";

/**
 * The gap between scheduled backups in milliseconds, or null when the interval
 * setting turns them off (0, or not a number). Read at each scheduling, so a
 * changed setting applies to the next one.
 */
export function backupIntervalMs(): number | null {
  const hours = backupIntervalHours().value;
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : null;
}

/**
 * Move the next scheduled backup to one interval from now, or cancel it when
 * the interval is off, when the setting changes. Nothing when
 * DISABLE_BACKGROUND_JOBS is true.
 *
 * @returns when the next scheduled backup runs, in epoch milliseconds, or null
 *   when there is none.
 */
export function rescheduleBackups(): number | null {
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return null;

  const hours = backupIntervalHours().value;
  const every = backupIntervalMs();
  if (every === null) {
    log.info("Backup", `Scheduled backups disabled (interval=${hours})`);
    scheduleNextRun(SCHEDULED_BACKUP_JOB, null);
    return null;
  }

  warnAboutStaleBackups(hours);
  const next = Date.now() + every;
  scheduleNextRun(SCHEDULED_BACKUP_JOB, next);
  log.info("Backup", `Scheduled backups every ${hours}h (keep ${keepCount()})`);
  return next;
}

/** When the next scheduled backup runs, or null when none is queued. */
export function nextBackupRun(): string | null {
  return nextRunOf(SCHEDULED_BACKUP_JOB);
}

/**
 * Boot: warn when the backups seem to have stopped, and log how often they run.
 * The runner schedules the runs as jobs: the startup snapshot 15 seconds after
 * boot, so migrations and backfills settle first, and the scheduled backup
 * every interval.
 *
 * @returns the gap between scheduled backups in milliseconds, or null when they
 *   are off or background jobs are.
 */
export function startBackupSchedule(): number | null {
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return null;

  const hours = backupIntervalHours().value;
  const every = backupIntervalMs();
  if (every === null) {
    log.info("Backup", `Scheduled backups disabled (interval=${hours})`);
    return null;
  }

  warnAboutStaleBackups(hours);
  log.info("Backup", `Scheduled backups every ${hours}h (keep ${keepCount()})`);
  return every;
}

/** Cancel the next scheduled backup. Nothing runs until it is rescheduled. */
export function stopBackupSchedule(): void {
  scheduleNextRun(SCHEDULED_BACKUP_JOB, null);
}
