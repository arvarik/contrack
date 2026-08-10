// =============================================================================
// Backup Service — scheduled SQLite snapshots with rotation
// =============================================================================
// Uses better-sqlite3's online backup API (safe while the DB is in use, WAL
// included) to snapshot curator.db into DATA_DIR/backups/. A CRM database is
// irreplaceable personal data — backups turn a bad bulk operation or disk
// failure from catastrophic into annoying.
//
// Config (env):
//   BACKUP_INTERVAL_HOURS — schedule cadence (default 24; 0 disables schedule)
//   BACKUP_KEEP           — rotation depth (default 7 most recent)
// =============================================================================

import fs from "fs";
import path from "path";
import { sqlite } from "../db.ts";
import { DATA_DIR, ensureDir } from "../utils/paths.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

export const BACKUPS_DIR = path.join(DATA_DIR, "backups");

const DEFAULT_KEEP = 7;
const DEFAULT_INTERVAL_HOURS = 24;

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
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
      const stat = fs.statSync(path.join(BACKUPS_DIR, filename));
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Delete backups beyond the rotation depth (oldest first). */
function rotateBackups(): void {
  const excess = listBackups().slice(keepCount());
  for (const backup of excess) {
    try {
      fs.unlinkSync(path.join(BACKUPS_DIR, backup.filename));
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
  log.info(
    "Backup",
    `Snapshot ${filename} written (${(stat.size / 1024 / 1024).toFixed(2)} MB in ${Date.now() - startMs}ms)`,
  );

  rotateBackups();
  return {
    filename,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
  };
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

  // Startup snapshot shortly after boot (let migrations/backfills settle).
  setTimeout(run, 15_000).unref();
  const handle = setInterval(run, hours * 3_600_000);
  handle.unref();
  log.info("Backup", `Scheduled backups every ${hours}h (keep ${keepCount()})`);
  return handle;
}
