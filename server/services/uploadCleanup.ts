// =============================================================================
// Upload cleanup: the files a delete leaves on disk
// =============================================================================
// A contact's photo, its attachments and its link-preview images are files
// under `uploads/u/<ownerId>/`. Rows cascade when a contact is deleted for
// good, files do not, and a file left behind is still served to its owner.
//
// Two paths remove them:
//
// - A purge collects the upload URLs of the rows it deletes before the
//   delete, and `removeUploads` unlinks them after the commit.
// - `sweepOrphanUploads` runs once a day and removes the files that no row
//   uses any more and that are old enough. It catches what a crash, a failed
//   request or a replaced photo left behind.
//
// Both ask the same question before they unlink: does any row still point at
// this file? Two contacts can share one photo (a merge copies the URL, and a
// connector reuses a file for the same remote photo), a merge log entry keeps
// the URLs that its undo puts back, and a note keeps its preview image in its
// HTML. Deleting a file that a row still uses is data loss, so a file that
// any of them names stays.
// =============================================================================

import fs from "fs";
import path from "path";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import {
  UPLOADS_DIR,
  ownerUploadDir,
  resolveUploadPath,
  type OwnerUploadKind,
} from "../utils/paths.ts";

/** The folders the cleanup reads, with the youngest file each may remove. */
const SWEPT_KINDS: Record<OwnerUploadKind, number> = {
  avatars: 2,
  files: 2,
  profile: 2,
  // A note draft keeps its preview's URL in the browser for up to 30 days
  // (src/lib/composerDrafts.ts) before the note is saved.
  previews: 31,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** One upload URL in any text: `/uploads/u/<owner>/<kind>/<file>`. */
const UPLOAD_URL =
  /\/uploads\/u\/([0-9a-f-]{36})\/(avatars|files|previews|profile)\/([A-Za-z0-9._-]+)/g;

/** A file name that UPLOAD_URL reads whole. */
const FILE_NAME = /^[A-Za-z0-9._-]+$/;

/** The owner segment `ownerUploadDir` accepts. */
const OWNER_ID = /^[0-9a-f-]{36}$/;

/** The upload URLs in `text` that belong to `ownerId`. */
export function ownerUploadUrls(
  ownerId: string,
  text: string | null | undefined,
): string[] {
  if (!text) return [];
  const urls: string[] = [];
  for (const match of text.matchAll(UPLOAD_URL)) {
    if (match[1] === ownerId) urls.push(match[0]);
  }
  return urls;
}

/**
 * Every upload URL of this owner that a row still names.
 *
 * Read once per cleanup, not once per file. The text columns are read only
 * where they contain the owner's folder, so a note without an upload costs a
 * LIKE and no parse.
 */
function referencedUploads(ownerId: string): Set<string> {
  const pattern = `%/uploads/u/${ownerId}/%`;
  const texts: (string | null)[] = [];
  const add = (rows: unknown[]) => {
    for (const row of rows as { text: string | null }[]) texts.push(row.text);
  };
  add(
    sqlite
      .prepare(
        `SELECT avatarUrl AS text FROM contacts
          WHERE ownerId = ? AND avatarUrl LIKE ?`,
      )
      .all(ownerId, pattern),
  );
  add(
    sqlite
      .prepare(`SELECT avatarUrl AS text FROM users WHERE id = ?`)
      .all(ownerId),
  );
  add(
    sqlite
      .prepare(
        `SELECT fileUrl AS text FROM interactions
          WHERE ownerId = ? AND fileUrl LIKE ?`,
      )
      .all(ownerId, pattern),
  );
  add(
    sqlite
      .prepare(
        `SELECT content AS text FROM interactions
          WHERE ownerId = ? AND content LIKE ?`,
      )
      .all(ownerId, pattern),
  );
  // An undo writes the snapshot's rows back, with their URLs.
  add(
    sqlite
      .prepare(
        `SELECT duplicateSnapshot AS text FROM dedupe_merge_log
          WHERE ownerId = ? AND duplicateSnapshot LIKE ?`,
      )
      .all(ownerId, pattern),
  );
  // A failed import row keeps its payload for a retry.
  add(
    sqlite
      .prepare(
        `SELECT r.payload AS text FROM import_rows r
           JOIN imports i ON i.id = r.importId
          WHERE i.ownerId = ? AND r.payload LIKE ?`,
      )
      .all(ownerId, pattern),
  );
  const urls = new Set<string>();
  for (const text of texts) {
    for (const url of ownerUploadUrls(ownerId, text)) urls.add(url);
  }
  return urls;
}

/**
 * The file an upload URL names, when it is inside one of this owner's
 * folders. Null for anything else: another owner's file, the shared logos,
 * a path that walks out of the uploads root.
 */
function ownedFile(ownerId: string, url: string): string | null {
  const file = resolveUploadPath(url);
  if (!file) return null;
  const inside = (Object.keys(SWEPT_KINDS) as OwnerUploadKind[]).some(
    (kind) =>
      path.dirname(file) === path.resolve(ownerUploadDir(ownerId, kind)),
  );
  return inside ? file : null;
}

/**
 * Unlink the files these URLs name, after the rows that used them are gone.
 *
 * Call it after the transaction commits: an unlink cannot be rolled back.
 * A file that any row still names stays, and so does a file outside this
 * owner's folders. Never throws: the delete has already happened, and a file
 * this leaves behind is the daily sweep's.
 *
 * @returns how many files were removed.
 */
export function removeUploads(
  ownerId: string,
  urls: readonly string[],
): number {
  if (!OWNER_ID.test(ownerId)) return 0;
  const candidates = [...new Set(urls)].filter((url) =>
    ownedFile(ownerId, url),
  );
  if (candidates.length === 0) return 0;
  let referenced: Set<string>;
  try {
    referenced = referencedUploads(ownerId);
  } catch (err) {
    log.warn(
      "Uploads",
      `Files of deleted rows were left for the daily sweep: ${getErrorMessage(err)}`,
    );
    return 0;
  }
  let removed = 0;
  for (const url of candidates) {
    if (referenced.has(url)) continue;
    const file = ownedFile(ownerId, url);
    if (!file) continue;
    try {
      fs.unlinkSync(file);
      removed++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      log.warn("Uploads", `A file was not removed: ${getErrorMessage(err)}`);
    }
  }
  return removed;
}

/**
 * Remove the files under each account's folder that no row names.
 *
 * Only a regular file older than its folder's minimum age goes (two days, or
 * 31 for a link preview, which a note draft can hold that long), so a file
 * written a moment ago, whose row is not written yet, is never touched. Only
 * the folders of accounts that exist are read.
 *
 * @returns how many files were removed.
 */
export function sweepOrphanUploads(now = Date.now()): number {
  const owners = sqlite.prepare(`SELECT id FROM users`).all() as {
    id: string;
  }[];
  let removed = 0;
  for (const { id: ownerId } of owners) {
    if (!OWNER_ID.test(ownerId)) continue;
    if (!fs.existsSync(path.join(UPLOADS_DIR, "u", ownerId))) continue;
    let referenced: Set<string> | null = null;
    for (const [kind, minDays] of Object.entries(SWEPT_KINDS) as [
      OwnerUploadKind,
      number,
    ][]) {
      const dir = ownerUploadDir(ownerId, kind);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        // A name the URL pattern cannot read could never match a row, so it
        // stays rather than counting as unused. Every name the app writes
        // fits the pattern.
        if (!entry.isFile() || !FILE_NAME.test(entry.name)) continue;
        const file = path.join(dir, entry.name);
        try {
          if (now - fs.lstatSync(file).mtimeMs < minDays * DAY_MS) continue;
          referenced ??= referencedUploads(ownerId);
          if (referenced.has(`/uploads/u/${ownerId}/${kind}/${entry.name}`)) {
            continue;
          }
          fs.unlinkSync(file);
          removed++;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          log.warn(
            "Uploads",
            `An unused file was not removed: ${getErrorMessage(err)}`,
          );
        }
      }
    }
  }
  if (removed > 0) {
    log.info("Uploads", `Removed ${removed} file(s) that no row uses`);
  }
  return removed;
}
