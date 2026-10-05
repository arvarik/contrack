/**
 * `lastContactedAt`, derived from the timeline in SQL.
 *
 * The column is a cache of the newest interaction. Every write that moves
 * an interaction on or off a contact (a new note, a delete, a merge and its
 * undo) sets it again from the interactions, with the one rule below.
 *
 * @module server/services/lastContacted
 */
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";

/**
 * Now, in the same shape the app writes timestamps in.
 *
 * `datetime('now')` gives `2026-09-11 18:45:11` and the app writes
 * `2026-09-11T18:45:10.665Z`. The two do not compare as strings, because a
 * space sorts below `T`, so a clamp built on `datetime('now')` would treat
 * every ISO timestamp as the later value and clamp nothing.
 */
export const NOW_ISO_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/**
 * `lastContactedAt` is the newest interaction, and never the future.
 *
 * The column is derived from `MAX(interactions.date)`, and the route refuses a
 * future date with five minutes of clock slack. `MIN` here closes the slack
 * and the rows an older version wrote: `recencyScore` returns 100 for any date
 * at or ahead of now and 91.68 one millisecond later, so a contact stamped
 * ahead scores full marks on a 40 percent signal until the next real
 * interaction. Recorded as A-05 in `.agent/STATUS.md`.
 *
 * SQLite's two-argument `MIN` returns NULL when either side is NULL, so a
 * contact with no interactions left still comes out NULL rather than now.
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
 * Set `lastContactedAt` of each contact from its own interactions.
 *
 * For a write that moved interactions between contacts, such as a merge or
 * its undo. Runs inside the caller's transaction.
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
