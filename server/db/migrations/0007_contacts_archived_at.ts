// =============================================================================
// Migration 0007_contacts_archived_at
// =============================================================================
// A contact keeps the time it was archived. The Archived page showed the
// last edit as if it were that time. Two triggers stamp it, as the trackedAt
// triggers stamp tracking: archiving sets it, and taking a contact out of the
// archive clears it.
//
// A contact archived before this has no record of the time. Its last edit is
// the best guess, because archiving is an edit and an archived contact is
// seldom edited again. The guess is written before the edit triggers are
// made again, so writing it is not an edit.
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
  // tenant-lint: allow boot migration
  db.exec(`
    ALTER TABLE contacts ADD COLUMN archivedAt TEXT;
    UPDATE contacts SET archivedAt = updatedAt WHERE isArchived = 1;
  `);

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

    CREATE TRIGGER contacts_archive_stamp_ins
    AFTER INSERT ON contacts
    FOR EACH ROW
    WHEN NEW.isArchived = 1 AND NEW.archivedAt IS NULL
    BEGIN
      UPDATE contacts SET archivedAt = datetime('now') WHERE id = NEW.id;
    END;

    CREATE TRIGGER contacts_archive_stamp_upd
    AFTER UPDATE OF isArchived ON contacts
    FOR EACH ROW
    WHEN NEW.isArchived IS NOT OLD.isArchived
    BEGIN
      UPDATE contacts
         SET archivedAt = CASE WHEN NEW.isArchived = 1 THEN datetime('now') ELSE NULL END
       WHERE id = NEW.id;
    END;
  `);
}
