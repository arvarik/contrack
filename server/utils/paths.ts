// Runtime data paths. All runtime data (the SQLite database, uploads, the model
// cache) lives under DATA_DIR. Outside Docker DATA_DIR is unset and everything
// resolves from the project root (./uploads, ./curator.db). In Docker,
// DATA_DIR=/app/data puts everything on the persistent volume.

import path from "path";
import fs from "fs";

/** Root directory for all runtime data (DB, uploads, model cache). */
export const DATA_DIR = process.env.DATA_DIR ?? process.cwd();

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const LOGOS_DIR = path.join(UPLOADS_DIR, "logos");

/**
 * The folders inside one owner's uploads directory:
 * - `avatars`: contact photos, uploaded or copied from a connector.
 * - `files`: interaction attachments.
 * - `profile`: the account's own photo.
 * - `previews`: link-preview images, downloaded once by the server so the
 *   browser never loads them from the linked site.
 *
 * Account deletion removes the whole `u/<ownerId>/` folder, so a new kind needs
 * no cleanup of its own.
 */
export type OwnerUploadKind = "avatars" | "files" | "profile" | "previews";

/**
 * Where one owner's uploads live: `UPLOADS_DIR/u/<ownerId>/<kind>/`. `logos/`
 * stays shared, because a company logo is not personal data and one employer
 * appears in many people's contacts. The id must have a UUID shape, not just be
 * escaped, because it becomes a path segment: `..` would walk out of the
 * uploads root before resolveUploadPath sees the result.
 */
export function ownerUploadDir(ownerId: string, kind: OwnerUploadKind): string {
  return path.join(UPLOADS_DIR, "u", assertOwnerId(ownerId), kind);
}

/** The public URL for a file in an owner's directory. */
export function ownerUploadUrl(
  ownerId: string,
  kind: OwnerUploadKind,
  filename: string,
): string {
  return `/uploads/u/${assertOwnerId(ownerId)}/${kind}/${path.basename(filename)}`;
}

const OWNER_ID_PATTERN = /^[0-9a-f-]{36}$/;

function assertOwnerId(ownerId: string): string {
  if (!OWNER_ID_PATTERN.test(ownerId)) {
    throw new Error(`Refusing to build an upload path for owner "${ownerId}"`);
  }
  return ownerId;
}

/** Create a directory (and parents) if it doesn't exist yet. */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolve a public `/uploads/...` URL path (as stored in `avatarUrl` or
 * `fileUrl`) to an absolute path inside UPLOADS_DIR, or null for anything else,
 * traversal like `/uploads/avatars/../../etc/passwd` included. Every read of a
 * stored upload URL goes through this, and every delete through
 * `resolveOwnUploadPath`: the columns are user-writable through the contact
 * update endpoints, and uploads/ holds every account's files.
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

/**
 * Resolve a stored `/uploads/...` URL only when it is inside this owner's
 * folder, `uploads/u/<ownerId>/`, or its `kind` folder when one is named; null
 * otherwise. `resolveUploadPath` alone allows any account's files, so an
 * `avatarUrl` of `/uploads/u/<another owner>/avatars/../files/<file>` would let
 * a photo upload delete another account's attachment.
 */
export function resolveOwnUploadPath(
  ownerId: string,
  urlPath: string,
  kind?: OwnerUploadKind,
): string | null {
  const abs = resolveUploadPath(urlPath);
  const dir = kind
    ? ownerUploadDir(ownerId, kind)
    : path.join(UPLOADS_DIR, "u", assertOwnerId(ownerId));
  return abs !== null && abs.startsWith(dir + path.sep) ? abs : null;
}
