/**
 * The SQLite connection, the migrations and the derived indexes. Every service
 * imports this file, and on import it:
 * 1. Opens the connection in WAL mode with foreign keys enforced.
 * 2. Applies the migrations in server/db/migrations/ this database has not run,
 *    each recorded in schema_migrations (server/db/runner.ts).
 * 3. Installs the FTS tables, the vec0 stores, the passage index and their
 *    triggers (server/db/indexes.ts).
 * 4. Runs the steps every boot needs (section 3 below).
 *
 * A helper in server/db/ takes the connection, and the wrapper here binds it to
 * this one.
 *
 * @module server/db
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema.ts";
import { log } from "./utils/logger.ts";
import crypto from "crypto";
import { runMigrations } from "./db/runner.ts";
import { MIGRATIONS } from "./db/migrations/index.ts";
import { installIndexes } from "./db/indexes.ts";
import {
  ensureLocalOwner as ensureLocalOwnerOn,
  primaryAdminId as primaryAdminIdOn,
} from "./db/owners.ts";
import { tableExists as tableExistsOn } from "./db/vec.ts";

// 1. The connection

import path from "path";
// Under Vitest the database must live in a DATA_DIR the test setup made. The
// fallback, ./curator.db, is the developer's own data when the suite runs from
// a checkout.
if (process.env.VITEST && !process.env.DATA_DIR) {
  throw new Error(
    "DATA_DIR is not set under Vitest. The fallback ./curator.db is real data, so a test setup must give each file a temp DATA_DIR.",
  );
}
const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "curator.db")
  : "curator.db";
export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// PRAGMAs. They cut cold-start query latency by about 3 to 5 times and skip
// needless fsyncs. Each one is logged at startup.

// About 8 MB of pages in SQLite's page cache (negative = kilobytes; the default
// is 2 MB), which holds most of a typical database.
sqlite.pragma("cache_size = -8000");

// Memory-map up to 256 MB of the file, so reads skip the read() syscall.
sqlite.pragma("mmap_size = 268435456");

// NORMAL is crash-safe in WAL mode against an application crash and allows
// group commits. Only an OS crash during a checkpoint could lose the latest
// transaction, which is acceptable for a personal CRM.
sqlite.pragma("synchronous = NORMAL");

// Temporary tables and indexes in memory, for joins and sorts on non-indexed
// columns in the dashboard and dedupe scans.
sqlite.pragma("temp_store = MEMORY");

// Several background writers (geocoder, embedding backfills, dedupe, scoring)
// share the lock, so a write waits up to 5 s for it instead of failing at once
// with SQLITE_BUSY.
sqlite.pragma("busy_timeout = 5000");

import fs from "fs";

const dbSizeMB = (() => {
  try {
    return (fs.statSync(DB_PATH).size / (1024 * 1024)).toFixed(2);
  } catch {
    return "0.00";
  }
})();

log.info("Database", `Opened ${DB_PATH} (WAL mode, foreign keys ON)`, {
  fileSizeMB: dbSizeMB,
});

// sqlite-vec, loaded before any DDL that creates vec0 tables.

import * as sqliteVec from "sqlite-vec";
sqliteVec.load(sqlite);
const { vec_version } = sqlite
  .prepare("SELECT vec_version() AS vec_version")
  .get() as { vec_version: string };
log.info("Database", `sqlite-vec loaded (version ${vec_version})`);

/**
 * The sqlite-vec build this process loaded, for the admin health panel, so an
 * operator can confirm an upgrade without opening the database.
 */
export const VEC_VERSION = vec_version;

// Before any migration: vector queries depend on partition keys (0.1.6), so an
// instance without them refuses to start rather than migrate and then fail.
// `assertVecVersion` is a hoisted function declaration, so it is callable here.
assertVecVersion(vec_version);

export const db = drizzle(sqlite, { schema });

// 2. Migrations, then the derived indexes. The runner applies every migration
//    this database has not run, in order, each in one transaction with its row
//    in schema_migrations. A migration that throws stops the boot with its id
//    in the error. Then every derived structure is installed and its version
//    recorded. A database holding a migration this build does not have refuses
//    to start.

runMigrations(sqlite, MIGRATIONS);
installIndexes(sqlite);

export {
  contactEditColumns,
  PIN_COLUMNS,
  SCORE_COLUMNS,
} from "./db/helpers.ts";
export {
  installVecStatusTriggers,
  VEC_ACTIVE_MATCH,
  VEC_METADATA_COLUMNS,
  VEC_METADATA_SQL,
  vecElementFor,
  vecTableDdl,
  type VecElement,
} from "./db/vec.ts";

/**
 * Tables that carry `ownerId`; after boot every row in them has an owner. A
 * migration that adds an owned table adds it here too, and the ownership guard
 * below checks every table in it on every boot.
 */
export const OWNED_TABLES = [
  "contacts",
  "lists",
  "interactions",
  "action_items",
  "dedupe_suggestions",
  "dedupe_exclusions",
  "dedupe_merge_log",
  "ai_invocations",
  "imports",
  "score_snapshots",
  "search_history",
  "connectors",
  "connector_runs",
  "connector_links",
  "upcoming_events",
  "map_views",
  // 0002_events_and_jobs
  "events",
] as const;

/**
 * The admin that instance-wide work acts as. Throws only if called before
 * ensureLocalOwner has run, which the boot order prevents.
 */
export function primaryAdminId(): string {
  return primaryAdminIdOn(sqlite);
}

/**
 * The account that owns this device's data when nobody has signed in. See
 * server/db/owners.ts.
 */
export function ensureLocalOwner(): string {
  return ensureLocalOwnerOn(sqlite);
}

/** True when the named table is already in this database. */
export function tableExists(name: string): boolean {
  return tableExistsOn(sqlite, name);
}

/**
 * Refuse to start below the release that introduced partition keys. The version
 * has a leading `v` and may have a pre-release suffix (`v0.1.10-alpha.4`), so
 * this compares three integers. As strings `"v0.1.10" < "v0.1.6"` is true, and
 * as versions it is false.
 */
export function assertVecVersion(version: string, minimum = [0, 1, 6]): void {
  const parts = version
    .replace(/^v/, "")
    .split(/[.-]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10));
  const found = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  for (let i = 0; i < 3; i++) {
    if (found[i] > minimum[i]) return;
    if (found[i] < minimum[i]) {
      throw new Error(
        `sqlite-vec >= ${minimum.join(".")} is required for partitioned vector search; found ${version}`,
      );
    }
  }
}

// 3. Every boot. After the migrations and the indexes:
// - the follow-up backfill, for a database written before every write made its
//   own follow-up task (`followUpTo` in contactService);
// - the ownership guard over the live OWNED_TABLES;
// - ANALYZE and PRAGMA optimize, for the planner;
// - the phonetic hash backfill, because ghost contacts from mentions and
//   connectors are written with no `phoneticHash`.

// Follow-up backfill: a contact with `nextFollowUpAt` and no open action item
// gets a "Follow up" item, so the triggers take over.

const orphanedFollowUps = sqlite
  .prepare(
    // tenant-lint: allow boot migration
    `
  SELECT id, nextFollowUpAt FROM contacts
  WHERE nextFollowUpAt IS NOT NULL
    AND id NOT IN (SELECT DISTINCT contactId FROM action_items WHERE completedAt IS NULL)
`,
  )
  .all() as { id: string; nextFollowUpAt: string }[];

if (orphanedFollowUps.length > 0) {
  // No ownerId here on purpose: the migrations installed
  // `action_items_owner_fill`, which copies the owner from the parent contact.
  // tenant-lint: allow boot migration
  const insertStmt = sqlite.prepare(`
    INSERT INTO action_items (id, contactId, title, dueAt)
    VALUES (?, ?, 'Follow up', ?)
  `);
  const txn = sqlite.transaction(() => {
    for (const c of orphanedFollowUps) {
      insertStmt.run(crypto.randomUUID(), c.id, c.nextFollowUpAt);
    }
  });
  txn();
  log.info(
    "Database",
    `Backfilled ${orphanedFollowUps.length} action_items from legacy nextFollowUpAt`,
  );
}

// Ownership guard. Without the column on an owned table, scoped queries would
// return the wrong rows rather than fail, so boot fails here instead.

for (const table of OWNED_TABLES) {
  const columns = sqlite.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some((c) => c.name === "ownerId")) {
    throw new Error(
      `Table "${table}" has no ownerId column after the tenancy migration. Refusing to start.`,
    );
  }
}

// Planner statistics for the indexes the migrations built. `PRAGMA optimize`
// alone only re-analyzes tables that already have sqlite_stat1 rows, so this
// runs ANALYZE once per boot, which is cheap at this size.
sqlite.exec("ANALYZE");
sqlite.pragma("optimize");

/**
 * Bring the planner's row counts up to date after a batch of writes.
 *
 * SQLite plans from the counts of the last ANALYZE, which boot gathers and a
 * daily timer refreshes. After 5,000 contacts were indexed, the counts said "2
 * rows" for a table of 22,000, and a keyword search took 145 seconds.
 * `optimize=0x10002` runs ANALYZE only on a table whose row count moved
 * tenfold, under SQLite's own time limit: on 5,800 contacts, 0.02 ms when
 * nothing moved and 3 ms for one stale table, against 20 ms for a full ANALYZE.
 * So every index-queue drain and backfill calls it. A failure is only logged.
 */
export function refreshPlannerStats(): void {
  try {
    sqlite.pragma("optimize=0x10002");
  } catch (error) {
    log.warn(
      "Database",
      `PRAGMA optimize failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Phonetic hash backfill: Double Metaphone for every contact without a
// phoneticHash. A no-op when there are none.

import { doubleMetaphone } from "./utils/nlp/index.ts";

const contactsMissingHash = sqlite
  .prepare(
    // tenant-lint: allow boot migration
    `
  SELECT id, name FROM contacts WHERE phoneticHash IS NULL AND name IS NOT NULL
`,
  )
  .all() as { id: string; name: string }[];

if (contactsMissingHash.length > 0) {
  const updateStmt = sqlite.prepare(
    // tenant-lint: allow boot migration
    `UPDATE contacts SET phoneticHash = ? WHERE id = ?`,
  );
  const backfillTxn = sqlite.transaction(() => {
    for (const c of contactsMissingHash) {
      const { primary } = doubleMetaphone(c.name);
      updateStmt.run(primary, c.id);
    }
  });
  backfillTxn();
  log.info(
    "Database",
    `Backfilled phoneticHash for ${contactsMissingHash.length} contacts`,
  );
}
