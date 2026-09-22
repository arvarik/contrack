/**
 * The catch-up rule, once, in SQL.
 *
 * A catch-up is a tracked contact whose clock is past its cadence. The clock
 * is the last interaction, or the moment of tracking when nothing is logged
 * yet, so a person tracked today at "every month" comes up in a month even
 * if the timeline is empty. The dashboard's Catch up list and count, and the
 * palette's zero state, all read these two strings, so they cannot disagree
 * about who needs a call. The MCP action items say the same thing with
 * `datetime(..., '+N days') <= now` in `mcpService.getActionItems`.
 *
 * Both strings expect the contacts table aliased `c`.
 *
 * @module server/services/catchUp
 */

/** Whole days since the clock, as an integer. */
export const CATCH_UP_DAYS_SINCE =
  "CAST(julianday('now') - julianday(COALESCE(c.lastContactedAt, c.trackedAt)) AS INTEGER)";

/** The predicate. Add `c.ownerId = ?` before it. */
export const CATCH_UP_WHERE = `c.isTracked = 1 AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND c.isGhost = 0
  AND (c.isArchived = 0 OR c.isArchived IS NULL) AND c.cadenceDays > 0
  AND ${CATCH_UP_DAYS_SINCE} - c.cadenceDays > 0`;
