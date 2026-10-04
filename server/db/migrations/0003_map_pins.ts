// =============================================================================
// Migration 0003_map_pins
// =============================================================================
// A pin is not an edit: a write to lat, lng or geoSource no longer stamps
// updatedAt or marks the score. setLocation stamps a person's move itself.
// The geocode cache keeps the place each answer names, and starts empty: an
// older row can hold an error as "nothing found", or a broader address's point.
// =============================================================================

import type Database from "better-sqlite3";

/** The contacts columns that are not edits, as they stood when this shipped. */
const NOT_EDITS = [
  "relationshipScore",
  "scoreDirty",
  "lat",
  "lng",
  "geoSource",
];

export function up(db: Database.Database): void {
  const edits = (db.pragma("table_info(contacts)") as { name: string }[])
    .map((c) => c.name)
    .filter((name) => !NOT_EDITS.includes(name))
    .map((name) => `"${name}"`)
    .join(", ");
  // tenant-lint: allow boot migration
  db.exec(`
    DROP TRIGGER contacts_auto_updated_at;
    CREATE TRIGGER contacts_auto_updated_at
    AFTER UPDATE OF ${edits} ON contacts
    FOR EACH ROW
    WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
    BEGIN
      UPDATE contacts SET updatedAt = datetime('now') WHERE id = NEW.id;
    END;

    DROP TRIGGER contacts_score_dirty;
    CREATE TRIGGER contacts_score_dirty
    AFTER UPDATE OF ${edits} ON contacts
    FOR EACH ROW
    WHEN NEW.scoreDirty = 0
    BEGIN
      UPDATE contacts SET scoreDirty = 1 WHERE id = NEW.id;
    END;

    ALTER TABLE geocode_cache ADD COLUMN displayName TEXT;
    DELETE FROM geocode_cache;
  `);
}
