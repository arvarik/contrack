// =============================================================================
// The vec0 vector stores
// =============================================================================
// Moved from server/db.ts (§9f and §9k-b), with the connection as a
// parameter. server/db.ts re-exports these names, bound to its connection
// where a function needs one, so callers import them from there as before.
//
// 9f. Contact embedding vector storage (requires sqlite-vec loaded above)
// 9f-b. Search embedding vector storage (local model, 384-dim, int8)
//
// Separate tables: the dedupe index and the search index hold different
// vectors of different widths from different models. Both are created from
// `vecTableDdl` below, so the shape is written once. Search vectors are int8
// (`vectorScale.ts`), dedupe vectors float.
// =============================================================================

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
 * The width a vec0 table actually has, read back from its DDL.
 *
 * The widths above are creation defaults and apply only on a fresh database.
 * Choosing a non-default embeddings model rebuilds these tables at that
 * model's width (see ensureEmbeddingStore / ensureDedupeEmbeddingStore), and
 * `IF NOT EXISTS` then leaves the existing table alone. Logging the literal
 * from the CREATE therefore reported 768/384 on every boot no matter what the
 * tables held — which is worse than saying nothing, because vector width is
 * the first thing you check when embeddings misbehave.
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
 * The three status columns every vec0 table carries beside its vector.
 *
 * They are sqlite-vec METADATA columns, which means a predicate on one is
 * evaluated inside the K-nearest-neighbour scan rather than after it. That is
 * the difference between "the ten nearest rows, of which some are archived"
 * and "the ten nearest rows that are not archived".
 *
 * The alternative, and what this replaced, was
 * `contactId IN (SELECT c.id FROM contacts c WHERE ...)`. It gives the same
 * answers — sqlite-vec pushes that constraint into the scan too — but SQLite
 * has to materialize the subquery first, which is a full scan of `contacts`
 * on every search. `EXPLAIN QUERY PLAN` shows it as `LIST SUBQUERY / SCAN c`.
 *
 * Measured through `findSearchNeighbors` itself, three accounts, k = 50, the
 * same table and the same vectors both ways:
 *
 *     1,000 contacts     0.83 ms  ->  0.10 ms
 *    10,000 contacts     8.16 ms  ->  0.36 ms
 *    50,000 contacts    43.68 ms  ->  1.48 ms
 *
 * Same fifty contacts in the same order both ways. The cost is proportional
 * to the account's contact count and independent of k, because the work is
 * building the id list rather than searching the vectors.
 *
 * `active` is one column rather than two because a vec0 metadata predicate is
 * a simple comparison: there is no `IS NULL` to push down, so the two null
 * checks are folded into a boolean when the row is written.
 */
export const VEC_METADATA_COLUMNS = [
  "isGhost",
  "isArchived",
  "active",
] as const;

/**
 * The metadata values for a contact, as a SQL expression list.
 *
 * Every insert into a vec0 table reads these from `contacts` in the same
 * statement, the way it already reads `ownerId`. sqlite-vec refuses a NULL
 * metadata value and refuses an INSERT that omits one, so there is no way to
 * write a row with the wrong status short of writing the wrong contact id.
 *
 * `c` is the alias the caller must give the contacts row.
 */
export const VEC_METADATA_SQL =
  "c.isGhost, COALESCE(c.isArchived, 0), (c.deletedAt IS NULL AND c.canonicalId IS NULL)";

/**
 * The predicate that keeps a KNN to contacts somebody can actually see.
 *
 * Bare column names, not `c.`-qualified: these are the vec0 table's own
 * columns, and the whole point is that there is no join to qualify them
 * against. It is the metadata-column form of `ACTIVE_CONTACT_SQL`.
 */
export const VEC_ACTIVE_MATCH = "isGhost = 0 AND isArchived = 0 AND active = 1";

/** What one vector component is stored as: a 4-byte float or 1 signed byte. */
export type VecElement = "float" | "int8";

/**
 * The element a vec0 table must store.
 *
 * `search_embeddings` is int8: a quarter of the space, with the same
 * neighbours up to rounding (`services/search/vectorScale.ts`).
 * `contact_embeddings` stays float, because dedupe compares its distances
 * with fixed thresholds.
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

// =============================================================================
// 9k-b. vec0 status triggers
// =============================================================================
// The metadata columns are only useful while they agree with the contact row.
// A vector is written once and then the contact is archived, restored,
// trashed, un-trashed, merged away or promoted out of ghost state, and every
// one of those happens somewhere other than the code that wrote the vector.
//
// So the database keeps them, not the application. This is the same argument
// the FTS index already makes: a trigger is the only place that sees every
// write, and a status column maintained by callers is a status column that is
// wrong as soon as somebody adds a caller.
//
// Narrow on purpose. `AFTER UPDATE OF` fires only when one of the four
// columns is in the SET list, and the WHEN clause drops the rest, so the
// hourly relationship-score recompute over every contact pays almost nothing.
// Measured on 10,000 contacts: 5,000 unrelated updates cost 2.9 ms with the
// trigger against 2.6 ms without, and 5,000 real status changes cost 15.3 ms.
// =============================================================================

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
