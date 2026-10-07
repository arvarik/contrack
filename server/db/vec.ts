// The vec0 vector stores, taking the connection as a parameter. server/db.ts
// re-exports these names, bound to its connection where a function needs one.
// The dedupe index (contact_embeddings) and the search index
// (search_embeddings) hold different vectors, of different widths, from
// different models, so they are separate tables. Both come from `vecTableDdl`
// below, so the shape is written once. Search vectors are int8
// (`vectorScale.ts`), dedupe vectors float.

import type Database from "better-sqlite3";
import { log } from "../utils/logger.ts";

/**
 * Create both stores when they are missing, and install the triggers that
 * keep their status columns true. Runs on every boot, from
 * server/db/indexes.ts.
 */
export function installVectorStores(sqlite: Database.Database): void {
  if (!tableExists(sqlite, "contact_embeddings")) {
    sqlite.exec(vecTableDdl("contact_embeddings", 768));
  }
  if (!tableExists(sqlite, "search_embeddings")) {
    sqlite.exec(
      vecTableDdl("search_embeddings", 384, vecElementFor("search_embeddings")),
    );
  }

  log.info(
    "Database",
    `contact_embeddings vec0 table ready (${vecTableWidth(sqlite, "contact_embeddings")}-dim, dedupe)`,
  );
  log.info(
    "Database",
    `search_embeddings vec0 table ready (${vecTableWidth(sqlite, "search_embeddings")}-dim ${vecElementOf(tableDdl(sqlite, "search_embeddings"))}, search)`,
  );

  installVecStatusTriggers(sqlite);
}

/**
 * The width a vec0 table has, read back from its DDL. The widths above are
 * creation defaults for a fresh database; a non-default embeddings model
 * rebuilds the tables at its own width (ensureEmbeddingStore,
 * ensureDedupeEmbeddingStore), and `IF NOT EXISTS` then leaves them alone, so
 * the CREATE literal would log the wrong width, the first thing to check when
 * embeddings misbehave.
 */
export function vecTableWidth(
  sqlite: Database.Database,
  table: string,
): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
    .get(table) as { sql?: string } | undefined;
  return row?.sql?.match(/(?:FLOAT|INT8)\[(\d+)\]/i)?.[1] ?? "unknown";
}

/**
 * The three status columns every vec0 table carries beside its vector. They are
 * sqlite-vec metadata columns, so a predicate on one is evaluated inside the
 * K-nearest-neighbor scan: "the ten nearest rows that are not archived", not
 * "the ten nearest rows, some archived".
 *
 * `contactId IN (SELECT c.id FROM contacts c WHERE ...)` gives the same
 * answers, but SQLite materializes the subquery first, a full scan of
 * `contacts` on every search (`LIST SUBQUERY / SCAN c`). Through
 * `findSearchNeighbors`, three accounts, k = 50, the same vectors both ways:
 *
 *     1,000 contacts     0.83 ms  ->  0.10 ms
 *    10,000 contacts     8.16 ms  ->  0.36 ms
 *    50,000 contacts    43.68 ms  ->  1.48 ms
 *
 * The same fifty contacts in the same order. The subquery's cost grows with the
 * account and not with k, because the work is building the id list.
 *
 * `active` is one column, not two, because a vec0 metadata predicate is a
 * simple comparison with no `IS NULL`, so the two null checks are folded into a
 * boolean when the row is written.
 */
export const VEC_METADATA_COLUMNS = [
  "isGhost",
  "isArchived",
  "active",
] as const;

/**
 * The metadata values for a contact, as a SQL expression list. Every vec0
 * insert reads them from `contacts` in the same statement, as it reads
 * `ownerId`. sqlite-vec refuses a NULL or missing metadata value, so a row
 * cannot get the wrong status short of the wrong contact id. `c` is the alias
 * the caller must give the contacts row.
 */
export const VEC_METADATA_SQL =
  "c.isGhost, COALESCE(c.isArchived, 0), (c.deletedAt IS NULL AND c.canonicalId IS NULL)";

/**
 * The predicate that keeps a KNN to contacts somebody can see: the
 * metadata-column form of `ACTIVE_CONTACT_SQL`. Bare column names, because they
 * are the vec0 table's own and there is no join.
 */
export const VEC_ACTIVE_MATCH = "isGhost = 0 AND isArchived = 0 AND active = 1";

/** What one vector component is stored as: a 4-byte float or 1 signed byte. */
export type VecElement = "float" | "int8";

/**
 * The element a vec0 table stores. `search_embeddings` is int8: a quarter of
 * the space, with the same neighbors up to rounding
 * (`services/search/vectorScale.ts`). `contact_embeddings` stays float, because
 * dedupe compares its distances with fixed thresholds.
 */
export function vecElementFor(table: string): VecElement {
  return table === "search_embeddings" ? "int8" : "float";
}

/** The element a vec0 table was created with, read from its DDL. */
function vecElementOf(ddl: string | undefined): VecElement {
  return ddl && /\bINT8\[/i.test(ddl) ? "int8" : "float";
}

/** The CREATE statement of a table, or undefined when it does not exist. */
function tableDdl(
  sqlite: Database.Database,
  table: string,
): string | undefined {
  return (
    sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
      .get(table) as { sql?: string } | undefined
  )?.sql;
}

/** vec0 tables and the DDL they must have. Pinned equal by a unit test. */
export function vecTableDdl(
  table: string,
  dimension: number,
  element: VecElement = "float",
): string {
  return `CREATE VIRTUAL TABLE ${table} USING vec0(
    contactId TEXT PRIMARY KEY,
    ownerId TEXT PARTITION KEY,
    isGhost INTEGER,
    isArchived INTEGER,
    active INTEGER,
    embedding ${element === "int8" ? "INT8" : "FLOAT"}[${dimension}]
  )`;
}

/** True when the named table is already in this database. */
export function tableExists(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table') AND name = ?",
      )
      .get(name) !== undefined
  );
}

// vec0 status triggers. The metadata columns are useful only while they agree
// with the contact row, and archiving, restoring, trashing, merging or
// promoting a ghost all happen away from the code that wrote the vector. So the
// database keeps them: a trigger is the only place that sees every write.
// Narrow on purpose: `AFTER UPDATE OF` fires only when one of the four columns
// is in the SET list, and the WHEN clause drops the rest, so the hourly score
// recompute pays almost nothing. On 10,000 contacts, 5,000 unrelated updates
// cost 2.9 ms with the trigger against 2.6 ms without, and 5,000 real status
// changes 15.3 ms.

/** Keep both vec0 tables' status columns equal to the contact row. */
export function installVecStatusTriggers(sqlite: Database.Database): void {
  // Both bodies write the one row the trigger fired for, and the vec0 tables
  // are derived from contacts and hold no other key.
  // tenant-lint: allow derived table
  sqlite.exec(
    ["search_embeddings", "contact_embeddings"]
      .map(
        (table) => `
    DROP TRIGGER IF EXISTS ${table}_status;
    CREATE TRIGGER ${table}_status
      AFTER UPDATE OF isGhost, isArchived, deletedAt, canonicalId ON contacts
      WHEN NEW.isGhost IS NOT OLD.isGhost
        OR NEW.isArchived IS NOT OLD.isArchived
        OR NEW.deletedAt IS NOT OLD.deletedAt
        OR NEW.canonicalId IS NOT OLD.canonicalId
    BEGIN
      UPDATE ${table}
         SET isGhost = NEW.isGhost,
             isArchived = COALESCE(NEW.isArchived, 0),
             active = (NEW.deletedAt IS NULL AND NEW.canonicalId IS NULL)
       WHERE contactId = NEW.id;
    END;`,
      )
      .join("\n"),
  );
}
