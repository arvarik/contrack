/**
 * `lastContactedAt`, derived from the timeline in SQL. The column caches the
 * newest interaction, and every write that moves an interaction on or off a
 * contact (a new note, a delete, a merge and its undo) sets it again from the
 * interactions, with the one rule below.
 *
 * @module server/services/lastContacted
 */
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";

/**
 * Now, in the shape the app writes timestamps in. `datetime('now')` gives
 * `2026-09-11 18:45:11` and the app writes `2026-09-11T18:45:10.665Z`, which do
 * not compare as strings (a space sorts below `T`), so a clamp built on
 * `datetime('now')` would clamp nothing.
 */
export const NOW_ISO_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/**
 * `lastContactedAt` is the newest interaction, and never the future. The route
 * refuses a future date with five minutes of clock slack (one day for a date
 * with no time), and `MIN` here closes the slack and any older row ahead of
 * now: `recencyScore` returns 100 for any date at or ahead of now, so a contact
 * stamped ahead would score full marks on a 40 percent signal until its next
 * real interaction. SQLite's two-argument `MIN` returns NULL when either side
 * is NULL, so a contact with no interactions left stays NULL.
 *
 * @param contactColumn - Placeholder or literal for the contact id.
 * @param ownerColumn - Placeholder or literal for the owner id.
 */
export function lastContactedSql(
  contactColumn: string,
  ownerColumn: string,
): string {
  return (
    // tenant-lint: allow owner-checked by caller
    `MIN((SELECT MAX(date) FROM interactions ` +
    `WHERE contactId = ${contactColumn} AND ownerId = ${ownerColumn}), ${NOW_ISO_SQL})`
  );
}

/**
 * Set each contact's `lastContactedAt` from its own interactions, after a write
 * that moved interactions between contacts, such as a merge or its undo. Runs
 * inside the caller's transaction.
 *
 * @param scope - The owner of every contact named.
 * @param contactIds - The contacts to set.
 */
export function recomputeLastContacted(
  scope: Scope,
  contactIds: readonly string[],
): void {
  const stmt = sqlite.prepare(
    `UPDATE contacts SET lastContactedAt = ${lastContactedSql("?", "?")}
      WHERE id = ? AND ownerId = ?`,
  );
  for (const id of contactIds) {
    stmt.run(id, scope.ownerId, id, scope.ownerId);
  }
}
