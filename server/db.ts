/**
 * Database Initialization — the SQLite connection, the migrations and the
 * derived indexes.
 *
 * Every service imports this file. On import it:
 * 1. Opens the SQLite connection in WAL mode with foreign keys enforced
 * 2. Applies the migrations in server/db/migrations/ that this database has
 *    not run, and records each in schema_migrations (server/db/runner.ts)
 * 3. Installs the FTS tables, the vec0 stores, the passage index and the
 *    triggers that feed them (server/db/indexes.ts)
 * 4. Runs the four steps that run on every boot (§3 below)
 *
 * The exports keep the names and signatures they had before the migrations
 * moved to server/db/. A helper that lives there takes the connection, and
 * the wrapper here binds it to this one.
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

// =============================================================================
// 1. Open SQLite Connection
// =============================================================================

import path from "path";
// Under Vitest the database must live in a DATA_DIR the test setup made. The
// fallback, ./curator.db, is the developer's own data when the suite runs
// from a checkout, and three unit tests once wrote test accounts into it.
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

// =============================================================================
// 1a. Performance PRAGMAs (Caching Strategy)
// =============================================================================
// These PRAGMAs are CRITICAL for a local-first app with an embedded 9–15MB
// database. They reduce cold-start query latency by ~3–5× and eliminate
// unnecessary fsync calls on writes. Each is explained inline.
//
// DIAGNOSTIC: All applied PRAGMAs are logged at startup so cache config is
// always visible when debugging performance issues.
// =============================================================================

// cache_size: Hold ~8MB of database pages in SQLite's internal page cache.
// Negative value = kilobytes. Default is -2000 (2MB). For a ~9MB database,
// -8000 (8MB) pins ~90% of pages, drastically reducing cold-start reads.
sqlite.pragma("cache_size = -8000");

// mmap_size: Memory-map the entire database file into virtual memory.
// This bypasses read() syscalls — the OS maps the file directly into the
// process address space. 256MB ceiling covers generous future growth.
sqlite.pragma("mmap_size = 268435456");

// synchronous: In WAL mode, NORMAL provides sufficient crash safety for a
// local-first app. It allows group commits (fewer fsync calls per transaction)
// while still guaranteeing durability against application crashes.
// Only an OS-level crash during a WAL checkpoint could theoretically lose the
// most recent transaction — an acceptable trade-off for a personal CRM.
sqlite.pragma("synchronous = NORMAL");

// temp_store: Keep temporary tables and indices in memory instead of disk.
// Relevant for complex JOINs in dashboard aggregations, dedupe scans, and
// any query that uses ORDER BY on non-indexed columns (which creates temp B-trees).
sqlite.pragma("temp_store = MEMORY");

// busy_timeout: With WAL mode + several background writers (geocode queue,
// embedding backfills, incremental dedupe, hourly score recompute), a
// concurrent write would otherwise surface immediately as SQLITE_BUSY (503).
// Wait up to 5s for the lock instead.
sqlite.pragma("busy_timeout = 5000");

// ── Diagnostic: Log all applied PRAGMA values for observability ──────────
import fs from "fs";

const dbSizeBytes = (() => {
  try {
    return fs.statSync(DB_PATH).size;
  } catch {
    return 0;
  }
})();
const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);

// Read back actual PRAGMA values (what SQLite accepted, not what we set)
const appliedCacheSize = (
  sqlite.pragma("cache_size") as { cache_size: number }[]
)[0]?.cache_size;
const appliedMmapSize = (
  sqlite.pragma("mmap_size") as { mmap_size: number }[]
)[0]?.mmap_size;
const appliedSynchronous = (
  sqlite.pragma("synchronous") as { synchronous: number }[]
)[0]?.synchronous;
const appliedTempStore = (
  sqlite.pragma("temp_store") as { temp_store: number }[]
)[0]?.temp_store;
const pageSize = (sqlite.pragma("page_size") as { page_size: number }[])[0]
  ?.page_size;
const pageCount = (sqlite.pragma("page_count") as { page_count: number }[])[0]
  ?.page_count;

const syncModeNames: Record<number, string> = {
  0: "OFF",
  1: "NORMAL",
  2: "FULL",
  3: "EXTRA",
};
const tempStoreNames: Record<number, string> = {
  0: "DEFAULT",
  1: "FILE",
  2: "MEMORY",
};

log.info("Database", `Opened ${DB_PATH} (WAL mode, foreign keys ON)`, {
  fileSizeMB: dbSizeMB,
  pageSize,
  pageCount,
  cacheSize: `${appliedCacheSize} (${Math.abs(appliedCacheSize as number)} KB)`,
  mmapSize: `${appliedMmapSize} (${((appliedMmapSize as number) / (1024 * 1024)).toFixed(0)} MB ceiling)`,
  synchronous:
    syncModeNames[appliedSynchronous as number] ?? appliedSynchronous,
  tempStore: tempStoreNames[appliedTempStore as number] ?? appliedTempStore,
});

// =============================================================================
// 1b. Load sqlite-vec Extension
// =============================================================================
// Must be loaded BEFORE any DDL that creates vec0 virtual tables.
// sqlite-vec adds native vector similarity search directly to SQLite.
// =============================================================================

import * as sqliteVec from "sqlite-vec";
sqliteVec.load(sqlite);
const { vec_version } = sqlite
  .prepare("SELECT vec_version() AS vec_version")
  .get() as { vec_version: string };
log.info("Database", `sqlite-vec loaded (version ${vec_version})`);

/**
 * The sqlite-vec build this process loaded.
 *
 * Read once at boot and exported for the admin health panel. An operator
 * confirming that an upgrade actually took effect should not have to open the
 * database to do it, and this is the one version number that comes from a
 * native extension rather than from a row we wrote ourselves.
 */
export const VEC_VERSION = vec_version;

// Before any migration runs. Partition keys arrived in 0.1.6 and vector
// queries depend on them, so an instance that cannot have them
// must refuse to start rather than migrate and then fail. `assertVecVersion`
// is declared below; a function declaration hoists, so it is callable here.
assertVecVersion(vec_version);

export const db = drizzle(sqlite, { schema });

// =============================================================================
// 2. Migrations, then the derived indexes
// =============================================================================
// The runner applies every migration this database has not run, in order,
// each in one transaction with its row in schema_migrations. A migration that
// throws stops the boot here, with its id in the error. Then every derived
// structure is installed, and its version recorded. A database holding a
// migration this build does not have refuses to start.
// =============================================================================

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
 * Tables that carry `ownerId`. Every row in each has an owner after boot.
 *
 * The live list. A migration that adds an owned table adds it here too, and
 * the ownership guard in §3 checks every table in it on every boot.
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
 * The admin that machine credentials and instance-wide work act as.
 *
 * Throws only if called before ensureLocalOwner has ever run, which the boot
 * order makes impossible.
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
 * Refuse to start below the release that introduced partition keys.
 *
 * The returned string carries a leading `v` and may carry a pre-release
 * suffix (`v0.1.10-alpha.4`), so this parses three integers rather than
 * comparing strings — `"v0.1.10" < "v0.1.6"` is true as a string and false as
 * a version.
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

// =============================================================================
// 3. Every boot
// =============================================================================
// Four steps run on every start, after the migrations and the indexes,
// because live code needs them and not only old rows:
//
// - §8, because POST /api/contacts still accepts `nextFollowUpAt`, and only
//   this turns it into a task.
// - §9i, the ownership guard over the live OWNED_TABLES.
// - ANALYZE and PRAGMA optimize, for the planner.
// - §10, because ghost contacts from mentions and connectors are written with
//   no `phoneticHash`, and only this fills it.
//
// =============================================================================

// =============================================================================
// 8. Backfill: Migrate existing nextFollowUpAt → action_items
// =============================================================================
// One-time migration: for contacts with nextFollowUpAt set but no action_items
// rows, create a default "Follow up" action item so the trigger system takes over.
// =============================================================================

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
  // No ownerId column here on purpose: §2z-4 runs before this section, so
  // `action_items_owner_fill` is installed and copies the owner from the
  // parent contact. Naming it here would duplicate the trigger, not replace
  // it, and every row this writes belongs to whoever owns the contact.
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

// =============================================================================
// 9i. Ownership guard
// =============================================================================
// The columns themselves are added in §2z-4, which has to run before §3
// because the FTS backfill selects `c.ownerId`. What stays here is the check
// that used to be implied by doing the work: if any owned table reached the
// end of boot without the column, scoped queries would return
// the wrong rows rather than fail, so this fails now instead.
// =============================================================================

for (const table of OWNED_TABLES) {
  const columns = sqlite.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some((c) => c.name === "ownerId")) {
    throw new Error(
      `Table "${table}" has no ownerId column after the tenancy migration. Refusing to start.`,
    );
  }
}

// =============================================================================
// 9h. Planner statistics
// =============================================================================
// Give the query planner statistics for the indexes the migrations built.
//
// `PRAGMA optimize` only re-analyzes tables that
// already have sqlite_stat1 rows, and nothing had ever run ANALYZE, so the
// owner-first composite indexes would have been invisible to the
// planner. This runs once per boot and is cheap on a database this size.
sqlite.exec("ANALYZE");
sqlite.pragma("optimize");

/**
 * Bring the planner's row counts up to date after a batch of writes.
 *
 * SQLite plans from the counts of the last ANALYZE, which the boot above
 * gathers and a daily timer refreshes. After a server indexed 5,000
 * contacts, the counts said "2 rows" for a table of 22,000, and a keyword
 * search took 145 seconds.
 *
 * `optimize=0x10002` looks at every table and runs ANALYZE only on a table
 * whose row count has moved tenfold, under SQLite's own time limit. On a
 * database of 5,800 contacts it takes 0.02 ms when nothing moved and 3 ms
 * for one stale table, where a full ANALYZE takes 20 ms. So every drain of
 * the index queue and every backfill calls it, and SQLite decides what is
 * stale. A failure is logged and no more: the counts stay as they were.
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

// =============================================================================
// 10. Phonetic Hash Backfill
// =============================================================================
// One-time idempotent backfill: compute Double Metaphone for all contacts
// that don't yet have a phoneticHash. On subsequent runs this is a no-op.
// =============================================================================

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
