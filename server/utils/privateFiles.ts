// =============================================================================
// Owner-only file modes for the data the server keeps
// =============================================================================
// The database, its backups, the uploads and the key that seals stored
// credentials all took the process's default umask, usually 022. On a
// machine with more than one account that made every contact, note and backup
// readable by every other local user, and only `secret.key` was written 0600.
//
// At boot the server sets the umask to 077, so everything it creates from
// then on is owner-only (files 0600, folders 0700), and it takes group and
// other access away from the data that already exists. A folder at 0700 is
// enough for the files under it, so the uploads tree is not walked file by
// file. Anything the server cannot change (a volume owned by another user)
// is reported, not fatal: refusing to start would help nobody.
// =============================================================================

import fs from "fs";
import path from "path";

/** Files 0600 and folders 0700 for everything created after this is set. */
export const PRIVATE_UMASK = 0o077;

/** The data that exists before the server writes anything, with its mode. */
export function privateDataPaths(
  dataDir: string,
): { target: string; mode: number }[] {
  const files = [
    "curator.db",
    "curator.db-wal",
    "curator.db-shm",
    "secret.key",
  ];
  const folders = ["uploads", "backups", ".cache", "models"];
  return [
    ...files.map((name) => ({ target: path.join(dataDir, name), mode: 0o600 })),
    ...folders.map((name) => ({
      target: path.join(dataDir, name),
      mode: 0o700,
    })),
  ];
}

/**
 * Set the umask, then remove group and other access from the data that is
 * already on disk. A path that is missing is skipped, and a path that already
 * allows only its owner is left alone.
 *
 * @returns the paths whose mode could not be changed
 */
export function makeDataPrivate(dataDir: string): string[] {
  process.umask(PRIVATE_UMASK);
  const failed: string[] = [];
  for (const { target, mode } of privateDataPaths(dataDir)) {
    try {
      if ((fs.statSync(target).mode & 0o077) === 0) continue;
      fs.chmodSync(target, mode);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") failed.push(target);
    }
  }
  return failed;
}
