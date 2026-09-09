import type Database from "better-sqlite3";

/** The active contact predicate shared by every search channel. */
export const ACTIVE_CONTACT_SQL = `c.isGhost = 0 AND COALESCE(c.isArchived, 0) = 0
  AND c.canonicalId IS NULL AND c.deletedAt IS NULL`;

const VERSION = 2;
const COLUMNS =
  "contactId, name, company, role, headline, location, about, industry, extras, searchExpansion";
const VALUES = `c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
  COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
  COALESCE(c.searchExpansion, '')`;

/** Columns which change search text or contact visibility. */
export const SEARCH_COLUMNS =
  "id, name, company, role, headline, location, about, industry, preferences, searchExpansion, isGhost, isArchived, canonicalId, deletedAt";

/** Install or migrate FTS atomically. FTS rowids match contact rowids for indexed deletes. */
export function installSearchIndex(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    const version = sqlite.pragma("user_version", { simple: true });
    if (version !== VERSION) sqlite.exec("DROP TABLE IF EXISTS contacts_fts");
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
        contactId UNINDEXED, name, company, role, headline, location, about, industry, extras, searchExpansion,
        prefix='2 3 4'
      );
      CREATE TABLE IF NOT EXISTS search_revision (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO search_revision VALUES (1, 0);
      DROP TRIGGER IF EXISTS contacts_ai;
      DROP TRIGGER IF EXISTS contacts_ad;
      DROP TRIGGER IF EXISTS contacts_au;
      CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
        INSERT INTO contacts_fts(rowid, ${COLUMNS}) SELECT c.rowid, ${VALUES}
        FROM contacts c WHERE c.id = new.id AND ${ACTIVE_CONTACT_SQL};
      END;
      CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
      END;
      CREATE TRIGGER contacts_au AFTER UPDATE OF ${SEARCH_COLUMNS} ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
        INSERT INTO contacts_fts(rowid, ${COLUMNS}) SELECT c.rowid, ${VALUES}
        FROM contacts c WHERE c.id = new.id AND ${ACTIVE_CONTACT_SQL};
      END;
    `);
    for (const event of ["INSERT", "UPDATE", "DELETE"]) {
      sqlite.exec(`
        DROP TRIGGER IF EXISTS search_revision_${event};
        CREATE TRIGGER search_revision_${event} AFTER ${event} ON contacts BEGIN
          UPDATE search_revision SET revision = revision + 1 WHERE id = 1;
        END;
      `);
    }
    for (const table of ["tags", "interests", "emails", "phones"]) {
      for (const [suffix, event, ids] of [
        ["ai", "INSERT", "new.contactId"],
        ["ad", "DELETE", "old.contactId"],
        ["au", "UPDATE", "old.contactId, new.contactId"],
      ]) {
        sqlite.exec(`
          DROP TRIGGER IF EXISTS fts_${table}_${suffix};
          CREATE TRIGGER fts_${table}_${suffix} AFTER ${event} ON contact_${table} BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (${ids});
          END;
        `);
      }
    }
    if (version !== VERSION) {
      sqlite.exec(
        "UPDATE contacts SET searchExpansion = NULL WHERE searchExpansion IS NOT NULL",
      );
    }
    sqlite.exec(`
      INSERT INTO contacts_fts(rowid, ${COLUMNS}) SELECT c.rowid, ${VALUES}
      FROM contacts c WHERE ${ACTIVE_CONTACT_SQL}
      AND NOT EXISTS (SELECT 1 FROM contacts_fts f WHERE f.rowid = c.rowid);
    `);
    sqlite.pragma(`user_version = ${VERSION}`);
  })();
}

/** Remove outdated vectors in the same transaction as the contact change. */
export function installSearchVectorTriggers(sqlite: Database.Database): void {
  sqlite.exec(`
    DROP TRIGGER IF EXISTS search_vector_update;
    CREATE TRIGGER search_vector_update AFTER UPDATE OF ${SEARCH_COLUMNS} ON contacts BEGIN
      DELETE FROM search_embeddings WHERE contactId = old.id;
    END;
    DROP TRIGGER IF EXISTS search_vector_delete;
    CREATE TRIGGER search_vector_delete AFTER DELETE ON contacts BEGIN
      DELETE FROM search_embeddings WHERE contactId = old.id;
    END;
  `);
}
