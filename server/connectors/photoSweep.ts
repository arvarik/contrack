// Copy stored Google photo URLs into uploads, once. A Google contact can still
// hold a googleusercontent.com photo URL, which the browser fetches from Google
// on every view, and an incremental sync rewrites only contacts that changed.
// This sweep runs once per boot, a few seconds after start, as the start-up job
// `connectors.photoSweep` (server/jobs/connectors.ts): it copies each stored
// Google photo into the owner's uploads and points the contact at the copy. A
// photo Google no longer serves (expired, 404) is cleared, so the contact shows
// its generated avatar. A failure that may pass (the network, a 5xx) leaves the
// row for the next boot. An avatar the person changed during the download is
// left alone.

import { sqlite } from "../db.ts";
import { scopeForOwnerId } from "../tenancy/scope.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { isTransientImageError } from "../utils/remoteImage.ts";
import { saveContactPhoto } from "./ingest.ts";

/** The photo host of the Google People API: lh3 to lh6, and others. */
const GOOGLE_PHOTO = "https://%.googleusercontent.com/%";

export interface PhotoSweepResult {
  saved: number;
  cleared: number;
  /** Rows left for the next boot, because the failure may pass. */
  deferred: number;
}

/** Copy every stored Google photo URL into uploads, or clear it. */
export async function localizeStoredGooglePhotos(): Promise<PhotoSweepResult> {
  const rows = sqlite
    .prepare(
      // tenant-lint: allow instance sweep
      "SELECT id, ownerId, avatarUrl FROM contacts WHERE avatarUrl LIKE ?",
    )
    .all(GOOGLE_PHOTO) as { id: string; ownerId: string; avatarUrl: string }[];

  // Written only if the avatar is still the URL the sweep read, so a change
  // the person made during the download wins.
  const replace = sqlite.prepare(
    "UPDATE contacts SET avatarUrl = ? WHERE id = ? AND ownerId = ? AND avatarUrl = ?",
  );

  const result: PhotoSweepResult = { saved: 0, cleared: 0, deferred: 0 };
  for (const row of rows) {
    try {
      const local = await saveContactPhoto(
        scopeForOwnerId(row.ownerId),
        row.avatarUrl,
      );
      replace.run(local, row.id, row.ownerId, row.avatarUrl);
      result.saved++;
    } catch (err) {
      if (isTransientImageError(err)) {
        result.deferred++;
        continue;
      }
      log.debug(
        "Connectors",
        `A stored contact photo is gone, so the contact shows its generated avatar: ${getErrorMessage(err)}`,
      );
      replace.run(null, row.id, row.ownerId, row.avatarUrl);
      result.cleared++;
    }
  }
  return result;
}

/**
 * Run the sweep once and say what it did. A failure of the whole sweep
 * throws, so the job that runs it records the failure.
 */
export async function sweepStoredPhotos(): Promise<PhotoSweepResult> {
  const result = await localizeStoredGooglePhotos();
  const { saved, cleared, deferred } = result;
  if (saved + cleared + deferred > 0)
    log.info(
      "Connectors",
      `Stored Google photos: ${saved} copied into uploads, ${cleared} cleared, ${deferred} left for the next start`,
    );
  return result;
}
