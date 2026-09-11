import type Database from "better-sqlite3";
import { log } from "../../utils/logger.ts";

/** The active contact predicate shared by every search channel. */
export const ACTIVE_CONTACT_SQL = `c.isGhost = 0 AND COALESCE(c.isArchived, 0) = 0
  AND c.canonicalId IS NULL AND c.deletedAt IS NULL`;

// Version 3 adds `ownerTok`. The gate below drops and rebuilds the table when
// the stored user_version differs, so the first boot after upgrade re-indexes
// every active contact. Measured at 233 ms for 50,000 contacts.
/**
 * The FTS schema version, kept in `PRAGMA user_version`.
 *
 * Exported so the admin health panel can report what this database is on
 * without opening it, which is the whole point of the panel.
 */
export const FTS_SCHEMA_VERSION = 3;
const VERSION = FTS_SCHEMA_VERSION;

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
  // contacts_fts mirrors contacts. Every row this writes takes its owner from
  // the contact it copies: ${COLUMNS} ends in ownerTok and ${VALUES} ends in
  // OWNER_TOKEN_SQL("c"). The scanner reads the literal, not the constants it
  // interpolates, so it cannot see either.
  // tenant-lint: allow derived table
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
  // Each body acts on the single contact row the trigger fired for, and the
  // insert carries that row's owner token through ftsInsert. The deletes are
  // by rowid, which is the FTS mirror of that same row.
  // A nested backtick would split this template into fragments that the lint
  // scanner reads as separate statements, so the row expression is built
  // first and the trigger body stays one literal.
  const insertChangedContact = ftsInsert(
    `c.id = new.id AND ${ACTIVE_CONTACT_SQL}`,
  );
  // tenant-lint: allow derived table
  return `
      DROP TRIGGER IF EXISTS contacts_ai;
      DROP TRIGGER IF EXISTS contacts_ad;
      DROP TRIGGER IF EXISTS contacts_au;
      CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
        ${insertChangedContact};
      END;
      CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
      END;
      CREATE TRIGGER contacts_au AFTER UPDATE OF ${SEARCH_COLUMNS} ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
        ${insertChangedContact};
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
        // searchExpansion is a derived cache column, and the trigger clears
        // it for the contact that owns the child row that just changed. There
        // is no second contact it could reach.
        // tenant-lint: allow derived table
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
        // Only when the index version changed, and only over a derived cache
        // column, so every account's rows are meant to be cleared together.
        // tenant-lint: allow boot migration
        "UPDATE contacts SET searchExpansion = NULL WHERE searchExpansion IS NOT NULL",
      );
    }
    // Same reason as contactTriggerSql: one literal, so the scanner sees the
    // whole statement rather than the fragments around a nested backtick.
    // tenant-lint: allow derived table
    const insertMissingRows = ftsInsert(`${ACTIVE_CONTACT_SQL}
      AND NOT EXISTS (SELECT 1 FROM contacts_fts f WHERE f.rowid = c.rowid)`);
    sqlite.exec(`${insertMissingRows};`);
    sqlite.pragma(`user_version = ${VERSION}`);
  })();

  if (rebuilt) {
    const rows = sqlite
      // One number for the boot log: how many rows the rebuild wrote.
      // tenant-lint: allow boot migration
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

/**
 * The columns that make a stored search vector wrong.
 *
 * A shorter list than `SEARCH_COLUMNS`, and the difference is the point. The
 * FTS row mirrors a contact's status as well as its text, so every column
 * above re-indexes it. A vector encodes the TEXT — `contactToSearchText` reads
 * name, company, role, location, industry, headline, about, preferences, tags
 * and the expansion, and none of the four status columns — so archiving a
 * contact does not make its vector wrong.
 *
 * Until the vec0 status columns landed, the two lists were the same one, and
 * archiving a contact deleted its embedding and made the next backfill compute
 * it again from text that had not changed. Now the status lives in the index
 * and a trigger keeps it there, so a status change updates three integers
 * instead of discarding a vector.
 *
 * `ownerId` stays, because a reassigned contact's vector sits in the wrong
 * vec0 partition and a partition key is not something to update in place.
 */
export const SEARCH_VECTOR_COLUMNS =
  "name, company, role, headline, location, about, industry, preferences, searchExpansion, ownerId";

/** Remove outdated vectors in the same transaction as the contact change. */
export function installSearchVectorTriggers(sqlite: Database.Database): void {
  // Both bodies delete the vector of the one contact row the trigger fired
  // for. search_embeddings is derived from contacts and holds no other key.
  // tenant-lint: allow derived table
  sqlite.exec(`
    DROP TRIGGER IF EXISTS search_vector_update;
    CREATE TRIGGER search_vector_update AFTER UPDATE OF ${SEARCH_VECTOR_COLUMNS} ON contacts BEGIN
      DELETE FROM search_embeddings WHERE contactId = old.id;
    END;
    DROP TRIGGER IF EXISTS search_vector_delete;
    CREATE TRIGGER search_vector_delete AFTER DELETE ON contacts BEGIN
      DELETE FROM search_embeddings WHERE contactId = old.id;
    END;
  `);
}
