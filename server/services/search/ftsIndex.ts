import type Database from "better-sqlite3";
import { log } from "../../utils/logger.ts";

/** The active contact predicate shared by every search channel. */
export const ACTIVE_CONTACT_SQL = `c.isGhost = 0 AND COALESCE(c.isArchived, 0) = 0
  AND c.canonicalId IS NULL AND c.deletedAt IS NULL`;

// Version 3 adds `ownerTok`. The gate below drops and rebuilds the table when
// the stored user_version differs, so the first boot after upgrade re-indexes
// every active contact. Measured at 233 ms for 50,000 contacts.
const VERSION = 3;

/**
 * Every contacts_fts column, in order. Position 0 is the UNINDEXED contactId.
 *
 * `ownerTok` is last and indexed. Phase 2 scopes search by prefixing every
 * query with `ownerTok:<token> AND (...)`, which makes FTS5 intersect posting
 * lists inside the index instead of post-filtering rows the caller may not
 * read. An UNINDEXED ownerId column could not do that: FTS5's xBestIndex
 * pushes down only MATCH, rowid and rank.
 */
export const COLUMNS =
  "contactId, name, company, role, headline, location, about, industry, extras, searchExpansion, ownerTok";

/**
 * The owner token expression.
 *
 * The default unicode61 tokenizer splits on `-`, so a raw UUID would become
 * five tokens and `ownerTok:3f2c...` would match the wrong owners. Stripping
 * the hyphens and prefixing a letter produces one 33-character term. This must
 * stay identical to ownerToken() in server/tenancy/scope.ts, which a unit test
 * pins against SQLite's own replace().
 */
const OWNER_TOKEN_SQL = (alias: string) =>
  `'o' || replace(${alias}.ownerId, '-', '')`;

const VALUES = `c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
  COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
  COALESCE(c.searchExpansion, ''), ${OWNER_TOKEN_SQL("c")}`;

/**
 * Columns which change search text, contact visibility, or the owner token.
 *
 * `ownerId` is here so that reassigning a contact re-indexes its FTS row and
 * drops its now-mispartitioned search vector. The one owner change 2.0 makes
 * is the boot claim, which runs with these triggers dropped.
 */
export const SEARCH_COLUMNS =
  "id, name, company, role, headline, location, about, industry, preferences, searchExpansion, isGhost, isArchived, canonicalId, deletedAt, ownerId";

/** Insert the FTS row for one contact, or for every active contact. */
function ftsInsert(where: string): string {
  return `INSERT INTO contacts_fts(rowid, ${COLUMNS}) SELECT c.rowid, ${VALUES}
        FROM contacts c WHERE ${where}`;
}

/**
 * The three triggers that keep contacts_fts in step with contacts.
 *
 * Deletes are by `rowid`, which FTS5 pushes down. An earlier version deleted
 * by `contactId`, an UNINDEXED column, which the core evaluated after scanning
 * the whole virtual table: 0.50 ms per update at 5,000 rows against 0.04 ms
 * now. Never reintroduce a WHERE on contactId here.
 *
 * Exported so a unit test can snapshot the generated SQL.
 */
export function contactTriggerSql(): string {
  return `
      DROP TRIGGER IF EXISTS contacts_ai;
      DROP TRIGGER IF EXISTS contacts_ad;
      DROP TRIGGER IF EXISTS contacts_au;
      CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
        ${ftsInsert(`c.id = new.id AND ${ACTIVE_CONTACT_SQL}`)};
      END;
      CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
      END;
      CREATE TRIGGER contacts_au AFTER UPDATE OF ${SEARCH_COLUMNS} ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
        ${ftsInsert(`c.id = new.id AND ${ACTIVE_CONTACT_SQL}`)};
      END;`;
}

/** Install or migrate FTS atomically. FTS rowids match contact rowids for indexed deletes. */
export function installSearchIndex(sqlite: Database.Database): void {
  const started = performance.now();
  let rebuilt = false;
  sqlite.transaction(() => {
    const version = sqlite.pragma("user_version", { simple: true });
    rebuilt = version !== VERSION;
    if (rebuilt) sqlite.exec("DROP TABLE IF EXISTS contacts_fts");
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
        contactId UNINDEXED, name, company, role, headline, location, about, industry, extras, searchExpansion,
        ownerTok,
        prefix='2 3 4'
      );
      CREATE TABLE IF NOT EXISTS search_revision (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO search_revision VALUES (1, 0);
      ${contactTriggerSql()}
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
    if (rebuilt) {
      sqlite.exec(
        "UPDATE contacts SET searchExpansion = NULL WHERE searchExpansion IS NOT NULL",
      );
    }
    sqlite.exec(`
      ${ftsInsert(`${ACTIVE_CONTACT_SQL}
      AND NOT EXISTS (SELECT 1 FROM contacts_fts f WHERE f.rowid = c.rowid)`)};
    `);
    sqlite.pragma(`user_version = ${VERSION}`);
  })();

  if (rebuilt) {
    const rows = sqlite
      .prepare("SELECT COUNT(*) AS n FROM contacts_fts")
      .get() as {
      n: number;
    };
    log.info(
      "Database",
      `contacts_fts rebuilt at v${VERSION} with ownerTok: ${rows.n} rows in ${(performance.now() - started).toFixed(0)}ms`,
    );
  }
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
