// =============================================================================
// Backup Service — scheduled SQLite snapshots, verified and rotated
// =============================================================================
// Uses better-sqlite3's online backup API (safe while the DB is in use, WAL
// included) to snapshot curator.db into DATA_DIR/backups/. A CRM database is
// irreplaceable personal data — backups turn a bad bulk operation or disk
// failure from catastrophic into annoying.
//
// Every snapshot is opened again as soon as it is written. Until 2.0 nothing
// ever did: the file was produced, rotated, and trusted, and the first person
// to find out whether any of it worked would have been somebody restoring it
// after losing the original. A backup nobody has opened is a hope.
//
// Config (env):
//   BACKUP_INTERVAL_HOURS — schedule cadence (default 24; 0 disables schedule)
//   BACKUP_KEEP           — rotation depth (default 7 most recent)
// =============================================================================

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { OWNED_TABLES, sqlite } from "../db.ts";
import { DATA_DIR, ensureDir } from "../utils/paths.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

export const BACKUPS_DIR = path.join(DATA_DIR, "backups");

const DEFAULT_KEEP = 7;
const DEFAULT_INTERVAL_HOURS = 24;

/**
 * The tables a snapshot is counted against.
 *
 * The eight that carry an owner, plus `users`. Between them they hold every
 * row somebody would be upset to lose, and a snapshot that reads cleanly but
 * holds none of them is the failure this check exists for.
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
   * Null for a snapshot written before 2.0, or one whose sidecar was removed.
   * Not the same as a failed check, and the view says so.
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
 * Open a snapshot and decide whether it is a backup or just a file.
 *
 * Three things can be wrong, in increasing order of how quietly they fail:
 *
 * 1. The file does not open. A truncated or corrupted snapshot throws here
 *    rather than failing the integrity check below, so the open is inside the
 *    same try.
 * 2. `PRAGMA quick_check` reports damage. This reads every page and every
 *    index, which is the whole point of opening the file.
 * 3. The file is sound and empty. This is the one nobody would notice: a
 *    snapshot taken at the wrong moment, or of the wrong database, reads
 *    perfectly and restores nothing. A table that has rows in the live
 *    database and none in the snapshot fails the check.
 *
 * sqlite-vec is deliberately NOT loaded. Nothing counted here is a virtual
 * table, `quick_check` covers the vec0 shadow tables as ordinary pages, and
 * not loading an extension into a file of unknown soundness is one less way
 * for this to be the thing that crashes.
 */
export function verifyBackup(file: string): BackupVerification {
  const checkedAt = new Date().toISOString();
  const rows: Record<string, number> = {};
  const liveRows: Record<string, number> = {};

  for (const table of COUNTED_TABLES) {
    liveRows[table] = countRows(sqlite, table) ?? 0;
  }

  // Opening a snapshot creates its WAL companions, even read only: the file
  // was copied from a database in WAL mode, so SQLite builds the shared
  // memory index beside it. A read-only connection cannot clean them up when
  // it closes, so without this the backups directory grows a 32 KB `-shm` and
  // an empty `-wal` for every snapshot ever verified, and they outlive the
  // snapshot they belong to because rotation is not looking for them.
  //
  // Only what this open created is removed. A companion that was already
  // there belongs to somebody else and is left alone.
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
      // The `-wal` is empty by construction: a read-only connection cannot
      // write to it. The size check is what makes that a fact rather than an
      // assumption, because removing a WAL with anything in it would take the
      // snapshot's most recent pages with it.
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
  const n = Number(process.env.BACKUP_KEEP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_KEEP;
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

/** Delete backups beyond the rotation depth (oldest first). */
function rotateBackups(): void {
  const excess = listBackups().slice(keepCount());
  for (const backup of excess) {
    try {
      const file = path.join(BACKUPS_DIR, backup.filename);
      fs.unlinkSync(file);
      // The sidecar goes with the snapshot it describes. A verification left
      // behind would be adopted by the next file to take that name, and a
      // timestamped name only repeats if the clock goes backwards, which is
      // exactly when a stale answer would be least welcome.
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

/**
 * Take a snapshot now. Uses the online backup API — consistent even with
 * concurrent writers, and runs incrementally without blocking the event loop.
 */
export async function runBackup(): Promise<BackupInfo> {
  ensureDir(BACKUPS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `curator-${stamp}.db`;
  const dest = path.join(BACKUPS_DIR, filename);

  const startMs = Date.now();
  await sqlite.backup(dest);
  const stat = fs.statSync(dest);
  const writtenMs = Date.now() - startMs;

  // Opened again immediately. The check is worth almost nothing a week later
  // and everything now, because now is when the snapshot can be taken again.
  const verification = verifyBackup(dest);
  try {
    fs.writeFileSync(sidecarPath(dest), JSON.stringify(verification, null, 2));
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
}

/**
 * Complain at boot when the newest verified snapshot is too old.
 *
 * "Too old" is two intervals: one missed snapshot is a restart at the wrong
 * moment, two is a schedule that has stopped. Nothing here fixes anything —
 * the startup snapshot fifteen seconds later may well put it right — but the
 * log line is the only place an operator finds out that the backups they
 * think they have stopped happening some time ago.
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

/**
 * Start the recurring backup schedule (startup snapshot + interval).
 * Returns the interval handle, or null when disabled.
 */
export function startBackupSchedule(): NodeJS.Timeout | null {
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return null;

  // Empty string means UNSET, not zero. docker-compose renders an absent
  // variable as `BACKUP_INTERVAL_HOURS: ""`, and Number("") is 0 — under the
  // old `!== undefined` check that combination silently disabled the default
  // 24h snapshots for every Compose user. Only an explicit value counts.
  const raw = process.env.BACKUP_INTERVAL_HOURS?.trim();
  const hours = raw ? Number(raw) : DEFAULT_INTERVAL_HOURS;
  if (!Number.isFinite(hours) || hours <= 0) {
    log.info(
      "Backup",
      `Scheduled backups disabled (BACKUP_INTERVAL_HOURS=${raw})`,
    );
    return null;
  }

  const run = () =>
    runBackup().catch((err) =>
      log.warn("Backup", `Scheduled backup failed: ${getErrorMessage(err)}`),
    );

  warnAboutStaleBackups(hours);

  // Startup snapshot shortly after boot (let migrations/backfills settle).
  setTimeout(run, 15_000).unref();
  const handle = setInterval(run, hours * 3_600_000);
  handle.unref();
  log.info("Backup", `Scheduled backups every ${hours}h (keep ${keepCount()})`);
  return handle;
}
