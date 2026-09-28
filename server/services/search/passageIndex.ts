import type Database from "better-sqlite3";

/** Increase this when chunk boundaries or source serialization changes. */
export const PASSAGE_VERSION = 1;

export function passageVectorDdl(dimension: number): string {
  if (!Number.isInteger(dimension) || dimension < 1)
    throw new Error("Invalid passage vector dimension");
  return `CREATE VIRTUAL TABLE IF NOT EXISTS search_passage_vectors USING vec0(
    passageId TEXT PRIMARY KEY, ownerId TEXT PARTITION KEY,
    isGhost INTEGER, isArchived INTEGER, active INTEGER,
    embedding INT8[${dimension}]
  )`;
}

// sqlite-vec metadata updates require one primary-key lookup. The ordinary table fans out status changes.
/** Derived indexes follow the contact transaction, including cascaded deletes. */
export function installPassageIndex(
  db: Database.Database,
  dimension: number,
): void {
  db.exec(passageVectorDdl(dimension));
  // tenant-lint: allow derived table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_passages_fts USING fts5(
      text, ownerTok, tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS passages_insert AFTER INSERT ON search_passages BEGIN
      INSERT INTO search_passages_fts(rowid, text, ownerTok)
      VALUES (new.rowid, new.text, 'o' || replace(new.ownerId, '-', ''));
    END;
    CREATE TRIGGER IF NOT EXISTS passages_delete AFTER DELETE ON search_passages BEGIN
      DELETE FROM search_passages_fts WHERE rowid = old.rowid;
      DELETE FROM search_passage_vectors WHERE passageId = old.id;
    END;
    DROP TRIGGER IF EXISTS passages_visibility;
    CREATE TRIGGER passages_visibility AFTER UPDATE OF isGhost, isArchived, deletedAt, canonicalId ON contacts
    WHEN new.isGhost IS NOT old.isGhost OR new.isArchived IS NOT old.isArchived
      OR new.deletedAt IS NOT old.deletedAt OR new.canonicalId IS NOT old.canonicalId BEGIN
      UPDATE search_passages SET active = (new.isGhost = 0 AND COALESCE(new.isArchived, 0) = 0
        AND new.deletedAt IS NULL AND new.canonicalId IS NULL) WHERE contactId = new.id;
    END;
    CREATE TRIGGER IF NOT EXISTS passage_vector_status AFTER UPDATE OF active ON search_passages BEGIN
      UPDATE search_passage_vectors SET active = new.active WHERE passageId = new.id;
    END;
  `);
}
