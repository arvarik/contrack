// =============================================================================
// Runtime data paths — single source of truth
// =============================================================================
// All runtime data (SQLite DB, uploads, model cache) lives under DATA_DIR.
// Outside Docker DATA_DIR is unset and everything resolves relative to the
// project root, preserving the historical layout (./uploads, ./curator.db).
// In Docker, DATA_DIR=/app/data puts everything on the persistent volume.
// =============================================================================

import path from "path";
import fs from "fs";

/** Root directory for all runtime data (DB, uploads, model cache). */
export const DATA_DIR = process.env.DATA_DIR ?? process.cwd();

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const AVATARS_DIR = path.join(UPLOADS_DIR, "avatars");
export const LOGOS_DIR = path.join(UPLOADS_DIR, "logos");

/** Create a directory (and parents) if it doesn't exist yet. */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolve a public `/uploads/...` URL path (as stored in `avatarUrl` /
 * `fileUrl` columns) to an absolute filesystem path, guaranteed to stay
 * inside UPLOADS_DIR. Returns null for anything else — including traversal
 * attempts like `/uploads/avatars/../../etc/passwd`, which normalize to a
 * path outside the uploads root.
 *
 * Every unlink/read of a stored upload URL MUST go through this function;
 * these columns are user-writable via the contact update endpoints.
 */
export function resolveUploadPath(urlPath: string): string | null {
  if (!urlPath.startsWith("/uploads/")) return null;
  const relative = urlPath.slice("/uploads/".length);
  const abs = path.resolve(UPLOADS_DIR, relative);
  if (abs === UPLOADS_DIR || !abs.startsWith(UPLOADS_DIR + path.sep)) {
    return null;
  }
  return abs;
}
