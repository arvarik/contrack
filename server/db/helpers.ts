// =============================================================================
// Helpers the baseline migration and server/db.ts both need
// =============================================================================
// Moved from server/db.ts (§4, §9g and §11), with the connection as a
// parameter. The baseline migration runs them once. server/db.ts re-exports
// them, and the tests call them through it.
// =============================================================================

import type Database from "better-sqlite3";

/**
 * Columns that hold what Contrack computed about a contact, not the contact.
 *
 * Writing one of these is not an edit, so it neither stamps `updatedAt` nor
 * schedules another recompute.
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

/**
 * Settings the app no longer reads. The Mapbox geocoder is gone (Nominatim
 * is the one geocoder), and a key an admin stored before sat sealed in
 * `geo.mapboxKey` with nothing to read it and no control to remove it, and
 * rode along in every backup.
 */
export const RETIRED_SETTING_KEYS = ["geo.mapboxKey"] as const;

/** Delete the retired settings. A no-op once they are gone. */
export function deleteRetiredSettings(database: Database.Database): number {
  const remove = database.prepare(`DELETE FROM app_settings WHERE key = ?`);
  let removed = 0;
  for (const key of RETIRED_SETTING_KEYS) removed += remove.run(key).changes;
  return removed;
}

// =============================================================================
// 11. Mention Rows Backfill
// =============================================================================
// The names a model found in a note went into `interactions.mentions` (JSON)
// and never into `interaction_mentions`, so those people's timelines did not
// show the note and the Pulse Inbox did not count a ghost's notes. The
// extraction writes both now. This adds the rows that notes saved before it
// lack. On later runs it finds nothing, so it is a no-op.
//
// A row needs a live contact of the note's own owner: a merged ghost moved
// its rows to the contact it merged into, and a row for it would bring the
// merged record back into the graph. The note's own contact gets no row.
// Only an object element is read. `json_each` gives a string element as
// plain text, and `json_extract` on it throws, which would stop the boot.
// =============================================================================

/** Add the missing rows, and return how many it added. */
export function backfillMentionRows(sqlite: Database.Database): number {
  return sqlite
    .prepare(
      // tenant-lint: allow boot migration
      `
  INSERT OR IGNORE INTO interaction_mentions (interactionId, contactId)
  SELECT DISTINCT i.id, c.id
    FROM interactions i,
         json_each(CASE WHEN json_valid(i.mentions) AND json_type(i.mentions) = 'array'
                        THEN i.mentions ELSE '[]' END) m
    JOIN contacts c
      ON c.id = json_extract(CASE WHEN m.type = 'object' THEN m.value END, '$.contactId')
     AND c.ownerId = i.ownerId
   WHERE i.mentions IS NOT NULL
     AND c.id <> i.contactId
     AND c.deletedAt IS NULL
     AND c.canonicalId IS NULL
`,
    )
    .run().changes;
}
