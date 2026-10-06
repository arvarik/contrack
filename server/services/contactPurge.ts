// What "delete forever" has to reach. A merge keeps the merged-away contact as
// a hidden row (`canonicalId` points at the contact it went into) and a merge
// log entry with a snapshot of both, so the merge can be undone. A plain delete
// of the survivor would leave both: the hidden row keeps its name, notes and
// photo, and the snapshot the whole profile.
//
// So a purge takes the contact and every contact merged into it, along the
// chain, and deletes every merge log entry that names one of them. Everything
// here runs inside the caller's transaction and touches no file: the caller
// unlinks the URLs it collected after the commit (`removeUploads` in
// uploadCleanup.ts). After MERGE_UNDO_DAYS the daily job `contacts.mergePurge`
// deletes the hidden row and the entry (contactService.purgeExpiredMerges).

import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { ownerUploadUrls } from "./uploadCleanup.ts";

/** How long a merge can be undone, in days. */
export const MERGE_UNDO_DAYS = 90;

const placeholders = (ids: readonly string[]) => ids.map(() => "?").join(", ");

/**
 * The contact and every contact merged into it, at any depth: B merged into
 * A and A into C makes purging C take A and B too. Empty when the contact is
 * not the caller's.
 */
export function mergedChain(scope: Scope, id: string): string[] {
  const rows = sqlite
    .prepare(
      `WITH RECURSIVE chain(id) AS (
         SELECT id FROM contacts WHERE id = ? AND ownerId = ?
         UNION
         SELECT c.id FROM contacts c JOIN chain ON c.canonicalId = chain.id
          WHERE c.ownerId = ?
       )
       SELECT id FROM chain`,
    )
    .all(id, scope.ownerId, scope.ownerId) as { id: string }[];
  return rows.map((row) => row.id);
}

/**
 * The upload URLs that these contacts' rows name: their photos, their notes'
 * attachments and link-preview images, and the URLs in the merge log entries
 * that name them. Read before the delete, which takes the rows with it.
 */
export function uploadsOfContacts(
  scope: Scope,
  ids: readonly string[],
): string[] {
  if (ids.length === 0) return [];
  const owner = scope.ownerId;
  const pattern = `%/uploads/u/${owner}/%`;
  const list = placeholders(ids);
  const texts = [
    ...(sqlite
      .prepare(
        `SELECT avatarUrl AS text FROM contacts
          WHERE ownerId = ? AND id IN (${list})`,
      )
      .all(owner, ...ids) as { text: string | null }[]),
    ...(sqlite
      .prepare(
        `SELECT fileUrl AS text FROM interactions
          WHERE ownerId = ? AND contactId IN (${list}) AND fileUrl IS NOT NULL
         UNION ALL
         SELECT content AS text FROM interactions
          WHERE ownerId = ? AND contactId IN (${list}) AND content LIKE ?`,
      )
      .all(owner, ...ids, owner, ...ids, pattern) as { text: string | null }[]),
    ...(sqlite
      .prepare(
        `SELECT duplicateSnapshot AS text FROM dedupe_merge_log
          WHERE ownerId = ? AND (primaryId IN (${list}) OR duplicateId IN (${list}))
            AND duplicateSnapshot LIKE ?`,
      )
      .all(owner, ...ids, ...ids, pattern) as { text: string | null }[]),
  ];
  return texts.flatMap((row) => ownerUploadUrls(owner, row.text));
}

/**
 * Remove what outlives these contacts' rows: the merge log entries that name
 * one of them, and the name and payload an import kept for a row that made
 * one of them. The import row itself stays, so the import's counts do not
 * change.
 */
export function forgetPurgedContacts(scope: Scope, ids: readonly string[]) {
  if (ids.length === 0) return;
  const list = placeholders(ids);
  sqlite
    .prepare(
      `DELETE FROM dedupe_merge_log
        WHERE ownerId = ? AND (primaryId IN (${list}) OR duplicateId IN (${list}))`,
    )
    .run(scope.ownerId, ...ids, ...ids);
  sqlite
    .prepare(
      `UPDATE import_rows SET name = NULL, payload = NULL
        WHERE contactId IN (${list})
          AND importId IN (SELECT id FROM imports WHERE ownerId = ?)`,
    )
    .run(...ids, scope.ownerId);
}

/**
 * The merged-away contacts that no merge inside the undo window can bring
 * back, on every account. A merge that was undone brings nothing back.
 */
export function expiredMergedContacts(
  days = MERGE_UNDO_DAYS,
): { id: string; ownerId: string }[] {
  return sqlite
    .prepare(
      // tenant-lint: allow instance sweep
      `SELECT c.id, c.ownerId FROM contacts c
        WHERE c.canonicalId IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM dedupe_merge_log m
             WHERE m.ownerId = c.ownerId AND m.duplicateId = c.id
               AND m.undoneAt IS NULL
               AND datetime(m.mergedAt) >= datetime('now', ?)
          )`,
    )
    .all(`-${days} days`) as { id: string; ownerId: string }[];
}

/**
 * Delete the merge log entries older than the undo window, on every account.
 * Runs in the caller's transaction, after the hidden rows they could restore
 * are gone.
 *
 * @returns how many entries went.
 */
export function forgetExpiredMerges(days = MERGE_UNDO_DAYS): number {
  return sqlite
    .prepare(
      // tenant-lint: allow instance sweep
      `DELETE FROM dedupe_merge_log
        WHERE datetime(mergedAt) < datetime('now', ?)`,
    )
    .run(`-${days} days`).changes;
}
