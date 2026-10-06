// The contacts columns that are not edits. server/db.ts re-exports these, and
// `npm run db:new` uses contactEditColumns to write a migration that rebuilds
// the edit-time triggers after a new contacts column.

import type Database from "better-sqlite3";

/**
 * Columns that hold what Contrack computed about a contact. Writing one is not
 * an edit, so it neither stamps `updatedAt` nor schedules another recompute.
 */
export const SCORE_COLUMNS = ["relationshipScore", "scoreDirty"] as const;

/** The pin, placed by the geocoder or dragged by hand. Neither is an edit. */
export const PIN_COLUMNS = ["lat", "lng", "geoSource"] as const;

/** Every `contacts` column but the score and the pin, quoted for DDL. */
export function contactEditColumns(db: Database.Database): string[] {
  const notEdits: readonly string[] = [...SCORE_COLUMNS, ...PIN_COLUMNS];
  const columns = db.pragma("table_info(contacts)") as { name: string }[];
  return columns.map((c) => c.name).filter((name) => !notEdits.includes(name));
}
