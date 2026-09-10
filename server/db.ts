/**
 * Database Initialization — SQLite connection, Drizzle ORM, FTS5, and triggers.
 *
 * This file is the single source of truth for database setup. It:
 * 1. Opens the SQLite connection in WAL mode with foreign keys enforced
 * 2. Runs Drizzle Kit migrations from `./drizzle/`
 * 3. Creates and backfills the FTS5 full-text search index with triggers
 * 4. Installs `updatedAt` auto-stamp triggers for contacts and interactions
 *
 * @module server/db
 */
import Database from "better-sqlite3";
import {
  installSearchIndex,
  installSearchVectorTriggers,
} from "./services/search/ftsIndex.ts";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/db/schema.ts";
import { log } from "./utils/logger.ts";
import crypto from "crypto";

// =============================================================================
// 1. Open SQLite Connection
// =============================================================================

import path from "path";
import {
  AVATARS_DIR,
  UPLOADS_DIR,
  ownerUploadDir,
  ownerUploadUrl,
  resolveUploadPath,
} from "./utils/paths.ts";
const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "curator.db")
  : "curator.db";
export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// =============================================================================
// 1a. Performance PRAGMAs (Phase 0 — Caching Strategy)
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

// Before any migration runs. Partition keys arrived in 0.1.6 and every vector
// query from Phase 2 on depends on them, so an instance that cannot have them
// must refuse to start rather than migrate and then fail. `assertVecVersion`
// is declared at §9k; a function declaration hoists, so it is callable here.
assertVecVersion(vec_version);

export const db = drizzle(sqlite, { schema });

// =============================================================================
// 2. Run Drizzle Migrations
// =============================================================================
// Sequential, tracked migrations from the ./drizzle directory.
// Drizzle maintains a `__drizzle_migrations` meta-table to track which
// migrations have already been applied — guaranteeing idempotency.
// =============================================================================

migrate(db, { migrationsFolder: "./drizzle" });
log.info("Database", "Drizzle migrations applied successfully");

// =============================================================================
// 2z. Identity — users, sessions, and data ownership
// =============================================================================
// Declared here rather than as a Drizzle migration for the same reason
// `app_settings` is (§9g2): this file is the one place guaranteed to run
// before any query, and the DDL is trivially idempotent. The tables are still
// mirrored in src/db/schema.ts so the rest of the app gets Drizzle types.
//
// See the OWNERSHIP note in src/db/schema.ts for what `ownerId` means and why
// only four tables carry it.
// =============================================================================

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    displayName TEXT,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    lastLoginAt TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    userAgent TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
`);

// The ownership columns themselves are added in §9i, once every table that
// carries one has been created.

// Expired sessions are rejected on use, but sweeping them on boot keeps the
// table from accumulating rows nobody will ever look at again.
const sweptSessions = sqlite
  .prepare(`DELETE FROM sessions WHERE expiresAt <= datetime('now')`)
  .run();
if (sweptSessions.changes > 0) {
  log.info("Database", `Swept ${sweptSessions.changes} expired session(s)`);
}

/**
 * Bumped when the tenancy block gains a step an older database has not run.
 *
 * v1 adds the ownership columns, claims the existing rows, installs the
 * invariant triggers and the composite indexes. v2 drops the four
 * single-column owner indexes v1 created, now that the Phase 2 query plans
 * prove the composites serve every owner-first read.
 */
export const TENANCY_SCHEMA_VERSION = 2;

// =============================================================================
// 2z-backup. Copy the database before anything below changes it
// =============================================================================
// This is the file an operator restores if the upgrade goes wrong, so it has
// to predate every schema change — including the `users` columns in §2z-1,
// which would otherwise be baked into the "pre-tenancy" copy. Harmless to 1.x,
// which names its columns explicitly, but a backup that is not actually the
// state you were in is a bad thing to hand somebody at the worst moment.
//
// VACUUM INTO cannot run inside a transaction, which is the other reason it is
// here rather than in §2z-4.
// =============================================================================

// Only the v1 step rewrites data. v2 drops four indexes, which SQLite can
// rebuild from the table, so it is not worth copying the whole file for.
if (readTenancyVersion() < 1) {
  const contactCount = (
    sqlite
      .prepare(
        // tenant-lint: allow boot migration
        `SELECT COUNT(*) AS n FROM contacts`,
      )
      .get() as { n: number }
  ).n;
  // Nothing to lose on an empty database, and this is also the fresh-install
  // path, where a backup would just be noise in the data directory.
  if (contactCount > 0) backupBeforeTenancyMigration();
}

// =============================================================================
// 2z-0. Contacts columns the tenancy block indexes
// =============================================================================
// §3, §7, §9a and §9b add these columns further down the file. §2z-4 builds
// composite indexes over them, so on a fresh database they have to exist by
// then — Drizzle `0000` ships `isArchived` and `relationshipScore` but not
// `deletedAt`, `canonicalId`, `phoneticHash` or `searchExpansion`.
//
// Adding them here turns the later sections into no-ops. Each of those still
// guards itself, so no code there changed and an older database that already
// has the columns takes the same path it always did.
// =============================================================================

for (const column of [
  "searchExpansion TEXT",
  "deletedAt TEXT",
  "canonicalId TEXT",
  "isArchived INTEGER DEFAULT 0",
  "phoneticHash TEXT",
  "relationshipScore INTEGER DEFAULT 50",
]) {
  const name = column.split(" ")[0];
  const columns = sqlite.pragma("table_info(contacts)") as { name: string }[];
  if (!columns.some((c) => c.name === name)) {
    sqlite.exec(`ALTER TABLE contacts ADD COLUMN ${column}`);
    log.info("Database", `Added ${name} column to contacts (pre-tenancy)`);
  }
}

// =============================================================================
// 2z-1. Identity columns on users
// =============================================================================
// `status` and `credentialState` are what make the local owner account work:
// the local owner is the row with `credentialState = 'none'`, and a disabled
// account is one with `status = 'disabled'`.
//
// Two SQLite rules shape this list. A NOT NULL column added to an existing
// table needs a literal default. A column with a REFERENCES clause may only be
// added when its default is NULL. `createdBy` is the one foreign key here, so
// it is the one column with no default.
// =============================================================================

for (const column of [
  "status TEXT NOT NULL DEFAULT 'active'",
  "credentialState TEXT NOT NULL DEFAULT 'password'",
  "mustChangePassword INTEGER NOT NULL DEFAULT 0",
  "passwordChangedAt TEXT",
  "disabledAt TEXT",
  "createdBy TEXT REFERENCES users(id) ON DELETE SET NULL",
]) {
  const name = column.split(" ")[0];
  const columns = sqlite.pragma("table_info(users)") as { name: string }[];
  if (!columns.some((c) => c.name === name)) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN ${column}`);
    log.info("Database", `Added ${name} column to users`);
  }
}

// =============================================================================
// 2z-2. Identity tables
// =============================================================================
// `app_settings` moves up from §9g2 because §2z-4 stores the tenancy schema
// version in it. `PRAGMA user_version` already holds FTS_SCHEMA_VERSION and is
// a single 32-bit field, so a second migration cannot share that slot.
//
// `api_tokens`, `invitations`, `user_settings` and `audit_log` are created now
// and filled by Phase 3. They are here rather than in Phase 3 so that one
// migration touches `users` once, and so `attachPrincipal` can look up a
// personal token from this phase on.
// =============================================================================

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tokenHash TEXT NOT NULL UNIQUE,
    tokenPrefix TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    lastUsedAt TEXT,
    expiresAt TEXT,
    revokedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(userId);

  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    tokenHash TEXT NOT NULL UNIQUE,
    invitedBy TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL,
    acceptedAt TEXT,
    acceptedBy TEXT REFERENCES users(id) ON DELETE SET NULL,
    revokedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (userId, key)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actorUserId TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    targetType TEXT,
    targetId TEXT,
    details TEXT,
    ip TEXT,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actorUserId, createdAt DESC);
`);

// =============================================================================
// 2z-3. Dedupe tables
// =============================================================================
// Identical DDL to §9c, §9d and §9e, moved up because §2z-4 adds `ownerId` to
// every owned table and three of them are these. The sections below keep their
// statements and become no-ops; leaving them in place means an operator
// reading the dedupe section still finds the schema where they expect it.
// =============================================================================

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dedupe_suggestions (
    id TEXT PRIMARY KEY,
    contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    matchType TEXT NOT NULL,
    confidence REAL NOT NULL,
    reasoning TEXT NOT NULL,
    matchedField TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    reviewedAt TEXT,
    reviewedBy TEXT,
    UNIQUE(contactIdA, contactIdB)
  );
  CREATE INDEX IF NOT EXISTS idx_dedupe_status ON dedupe_suggestions(status);
  CREATE INDEX IF NOT EXISTS idx_dedupe_confidence ON dedupe_suggestions(confidence DESC);

  CREATE TABLE IF NOT EXISTS dedupe_exclusions (
    contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (contactIdA, contactIdB)
  );

  CREATE TABLE IF NOT EXISTS dedupe_merge_log (
    id TEXT PRIMARY KEY,
    primaryId TEXT NOT NULL,
    duplicateId TEXT NOT NULL,
    mergedBy TEXT NOT NULL,
    mergeType TEXT NOT NULL,
    confidence REAL NOT NULL,
    reasoning TEXT NOT NULL,
    mergedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    undoneAt TEXT,
    duplicateSnapshot TEXT
  );
`);

// =============================================================================
// 2z-4. Tenancy — ownership columns, the local owner, and the claim
// =============================================================================
// This block gives every row an owner. It has to run here, before §3, for two
// independent reasons found while reviewing the plan against the engine:
//
//   • The FTS backfill selects `c.ownerId`. A SELECT inside `exec` is prepared
//     before it runs, so a missing column fails the boot even on an empty
//     database. The column must exist first.
//   • The claim is a bulk UPDATE over `contacts`. The `_auto_updated_at`
//     triggers would stamp `updatedAt` on every row, and `findStaleEmbeddings`
//     re-embeds any contact whose `updatedAt` is newer than its `embeddedAt`.
//     A stamped corpus means the next deep dedupe scan re-embeds everything
//     through the paid provider. So the triggers come out first and §3 to §6
//     put them back on the same boot.
//
// Order inside the transaction is fixed: columns, trigger drops, local owner,
// claim, child backfill, invariant triggers, composite indexes, version write.
// The invariant triggers are installed last because they forbid the very NULLs
// the claim above them is there to remove.
// =============================================================================

/** Tables that carry `ownerId`. Every row in each has an owner after boot. */
export const OWNED_TABLES = [
  "contacts",
  "lists",
  "interactions",
  "action_items",
  "dedupe_suggestions",
  "dedupe_exclusions",
  "dedupe_merge_log",
  "ai_invocations",
] as const;

/** Owned tables with no parent contact. The caller must supply the owner. */
const OWNER_REQUIRED_TABLES = [
  "contacts",
  "lists",
  "dedupe_merge_log",
  "ai_invocations",
] as const;

/**
 * Owned tables whose owner is derivable from a parent contact.
 *
 * `key` names the primary parent column. `also` is a second contact column
 * that must agree, which is what makes a cross-owner dedupe pair impossible.
 * `pk` is how the fill trigger finds the row it just inserted: every table
 * here has an `id` except `dedupe_exclusions`, whose key is the pair.
 */
const OWNER_CHILD_TABLES = [
  { table: "interactions", key: "contactId", also: null, pk: "id = NEW.id" },
  { table: "action_items", key: "contactId", also: null, pk: "id = NEW.id" },
  {
    table: "dedupe_suggestions",
    key: "contactIdA",
    also: "contactIdB",
    pk: "id = NEW.id",
  },
  {
    table: "dedupe_exclusions",
    key: "contactIdA",
    also: "contactIdB",
    pk: "contactIdA = NEW.contactIdA AND contactIdB = NEW.contactIdB",
  },
] as const;

/**
 * Every trigger that has to be absent while the claim and the backfill run.
 *
 * §3 recreates the first six through installSearchIndex, and §4, §5 and §6
 * recreate the rest. Each of those sections already begins with a
 * DROP TRIGGER IF EXISTS, so a crash between here and there costs one process
 * lifetime and the next boot closes it.
 */
const TRIGGERS_DROPPED_FOR_CLAIM = [
  "contacts_ai",
  "contacts_au",
  "contacts_ad",
  "search_revision_INSERT",
  "search_revision_UPDATE",
  "search_revision_DELETE",
  "contacts_auto_updated_at",
  "interactions_auto_updated_at",
  "action_items_auto_updated_at",
  "action_items_sync_insert",
  "action_items_sync_update",
  "action_items_sync_delete",
  "search_vector_update",
  "search_vector_delete",
];

function countUsers(): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM users`).get() as {
    n: number;
  };
  return row.n;
}

/**
 * The admin that machine credentials and instance-wide work act as.
 *
 * Throws only if called before ensureLocalOwner has ever run, which the boot
 * order makes impossible.
 */
export function primaryAdminId(): string {
  const row = sqlite
    .prepare(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active'
       ORDER BY createdAt ASC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (!row) throw new Error("No active admin account exists");
  return row.id;
}

/**
 * The account that owns this device's data when nobody has signed in.
 *
 * `passwordHash = 'none$'` can never verify: parseHash splits on `$`, returns
 * null unless it gets six parts, and this has two. Nobody can sign in as this
 * account. It is an admin because in auth-off mode the person at the keyboard
 * is the operator.
 *
 * On an instance that already has real accounts this creates nothing and
 * returns the primary admin, so an upgrade never invents a second owner.
 */
export function ensureLocalOwner(): string {
  const existing = sqlite
    .prepare(`SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`)
    .get() as { id: string } | undefined;
  if (existing) return existing.id;
  if (countUsers() > 0) return primaryAdminId();

  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, displayName, passwordHash, role, credentialState)
       VALUES (?, 'local@contrack.local', 'local', 'This device', 'none$', 'admin', 'none')`,
    )
    .run(id);
  log.info("Database", `Created the local owner account (${id})`);
  return id;
}

/**
 * Assign every unowned row to `ownerId`.
 *
 * Lives here rather than in authService because db.ts cannot import that
 * module: authService imports `sqlite` from this file and prepares statements
 * at its top level.
 *
 * @returns rows claimed, per table
 */
export function claimUnownedData(ownerId: string): Record<string, number> {
  const claimed: Record<string, number> = {};
  sqlite.transaction(() => {
    for (const table of OWNED_TABLES) {
      const result = sqlite
        .prepare(
          // tenant-lint: allow boot migration
          `UPDATE ${table} SET ownerId = ? WHERE ownerId IS NULL`,
        )
        .run(ownerId);
      if (result.changes > 0) claimed[table] = result.changes;
    }
  })();
  return claimed;
}

function readTenancyVersion(): number {
  try {
    const row = sqlite
      .prepare(`SELECT value FROM app_settings WHERE key = 'schema.tenancy'`)
      .get() as { value: string } | undefined;
    if (!row) return 0;
    const parsed = Number(JSON.parse(row.value));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // No app_settings table yet, which means a database from before §9g2 or a
    // fresh one. Either way the tenancy migration has not run.
    return 0;
  }
}

function writeTenancyVersion(version: number): void {
  sqlite
    .prepare(
      `INSERT INTO app_settings (key, value, updatedAt)
       VALUES ('schema.tenancy', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP`,
    )
    .run(JSON.stringify(version));
}

/** SQL for the triggers that keep every owned row's owner true. */
function ownerInvariantTriggerSql(): string {
  const out: string[] = [];

  for (const table of OWNER_REQUIRED_TABLES) {
    out.push(
      `CREATE TRIGGER IF NOT EXISTS ${table}_owner_required BEFORE INSERT ON ${table}
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, '${table}.ownerId is required'); END;`,
    );
  }

  for (const { table, key, also, pk } of OWNER_CHILD_TABLES) {
    // The fill trigger is a safety net for callers that only know the parent
    // id. Services still pass ownerId, which takes the check path instead.
    out.push(
      `CREATE TRIGGER IF NOT EXISTS ${table}_owner_fill AFTER INSERT ON ${table}
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE ${table} SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.${key})
          WHERE ${pk};
       END;`,
    );

    const mismatch = [
      `NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.${key})`,
    ];
    if (also) {
      mismatch.push(
        `NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.${also})`,
      );
    }
    out.push(
      `CREATE TRIGGER IF NOT EXISTS ${table}_owner_check BEFORE INSERT ON ${table}
       WHEN NEW.ownerId IS NOT NULL AND (${mismatch.join(" OR ")})
       BEGIN SELECT RAISE(ABORT, '${table}.ownerId does not match the contact owner'); END;`,
    );
  }

  // The only owner change in 2.0 is the one-time claim above, which runs
  // before this trigger exists. It is here for a future "reassign data"
  // admin action. It cannot touch the vec0 tables: sqlite-vec refuses an
  // UPDATE of a partition key, so that feature re-inserts those rows in code.
  out.push(
    `CREATE TRIGGER IF NOT EXISTS contacts_owner_propagate AFTER UPDATE OF ownerId ON contacts
     WHEN NEW.ownerId IS NOT OLD.ownerId
     BEGIN
       UPDATE interactions       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
       UPDATE action_items       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
       UPDATE dedupe_suggestions SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
       UPDATE dedupe_exclusions  SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
     END;`,
  );

  return out.join("\n");
}

/** Composite indexes for the owner-first reads Phase 2 writes. */
const OWNER_COMPOSITE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_contacts_owner_status    ON contacts(ownerId, isGhost, isArchived, canonicalId);
  CREATE INDEX IF NOT EXISTS idx_contacts_owner_deleted   ON contacts(ownerId, deletedAt);
  CREATE INDEX IF NOT EXISTS idx_contacts_owner_lastc     ON contacts(ownerId, lastContactedAt);
  CREATE INDEX IF NOT EXISTS idx_contacts_owner_added     ON contacts(ownerId, addedAt);
  CREATE INDEX IF NOT EXISTS idx_contacts_owner_score     ON contacts(ownerId, relationshipScore);
  CREATE INDEX IF NOT EXISTS idx_contacts_owner_phonetic  ON contacts(ownerId, phoneticHash);
  CREATE INDEX IF NOT EXISTS idx_contacts_owner_canon     ON contacts(ownerId, canonicalId);
  CREATE INDEX IF NOT EXISTS idx_interactions_owner_date  ON interactions(ownerId, date);
  CREATE INDEX IF NOT EXISTS idx_action_items_owner_due   ON action_items(ownerId, dueAt) WHERE completedAt IS NULL;
  CREATE INDEX IF NOT EXISTS idx_action_items_owner_done  ON action_items(ownerId, completedAt);
  CREATE INDEX IF NOT EXISTS idx_lists_owner_sort         ON lists(ownerId, sortOrder);
  CREATE INDEX IF NOT EXISTS idx_dedupe_sugg_owner_status ON dedupe_suggestions(ownerId, status);
  CREATE INDEX IF NOT EXISTS idx_dedupe_sugg_owner_conf   ON dedupe_suggestions(ownerId, confidence DESC);
  CREATE INDEX IF NOT EXISTS idx_dedupe_excl_owner        ON dedupe_exclusions(ownerId);
  CREATE INDEX IF NOT EXISTS idx_merge_log_owner_at       ON dedupe_merge_log(ownerId, mergedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_inv_owner_created     ON ai_invocations(ownerId, createdAt DESC);
`;

/**
 * The single-column owner indexes v1 created, which v2 drops.
 *
 * Each one is the leading column of a composite above, so SQLite can answer
 * every query that used it from the composite instead. Leaving them costs a
 * second B-tree write on each insert, and gives the planner a narrower index
 * to prefer over the composite the Phase 2 plan tests pin.
 *
 * The other four owned tables also had one. Phase 2i drops the four the plan
 * names; docs/multi-tenant-plan/07-phase-2-scoping.md section 2i records why
 * the rest are still there.
 */
const OWNER_PREFIX_INDEXES = [
  "idx_contacts_owner",
  "idx_lists_owner",
  "idx_ai_invocations_owner",
  "idx_dedupe_merge_log_owner",
] as const;

/**
 * Copy the database before the first tenancy migration.
 *
 * VACUUM INTO is synchronous, correct in WAL mode, and produces one consistent
 * file — which sqlite.backup() would not, being asynchronous in a module that
 * runs at import time. It also cannot run inside a transaction, which is why
 * this happens before the transaction below opens.
 *
 * A missing backup never fails the boot. The operator still has the rotating
 * `curator-*.db` snapshots, and refusing to start would be a worse outcome
 * than starting without one extra copy.
 */
function backupBeforeTenancyMigration(): void {
  const dataDir = path.dirname(path.resolve(DB_PATH));
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(DB_PATH).size;
  } catch {
    return; // No file yet, so nothing to lose.
  }

  try {
    const stat = fs.statfsSync(dataDir);
    const freeBytes = stat.bavail * stat.bsize;
    if (freeBytes < dbBytes * 1.5) {
      log.error(
        "Database",
        `Skipping the pre-tenancy backup: ${(freeBytes / 1e6).toFixed(0)} MB free is below 1.5x the ${(dbBytes / 1e6).toFixed(0)} MB database. Restore from a curator-*.db snapshot if the upgrade goes wrong.`,
      );
      return;
    }
  } catch {
    // statfsSync is unavailable on some platforms. Attempt the copy anyway;
    // a genuine out-of-space error surfaces from VACUUM INTO below.
  }

  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let target = path.join(backupDir, `pre-tenancy-${stamp}.db`);
  for (let n = 2; fs.existsSync(target); n++) {
    target = path.join(backupDir, `pre-tenancy-${stamp}-${n}.db`);
  }

  const started = performance.now();
  try {
    // The name deliberately does not start with `curator-`, so backupService
    // never rotates this file away. The operator deletes it once they trust
    // the upgrade.
    sqlite.prepare(`VACUUM INTO ?`).run(target);
    log.info(
      "Database",
      `Pre-tenancy backup written to ${target} in ${(performance.now() - started).toFixed(0)}ms`,
    );
  } catch (err) {
    log.error("Database", `Pre-tenancy backup failed: ${String(err)}`);
  }
}

const tenancyVersion = readTenancyVersion();
if (tenancyVersion < TENANCY_SCHEMA_VERSION) {
  const migrationStarted = performance.now();
  const steps: string[] = [];
  const step = (label: string, fn: () => string | null): void => {
    const started = performance.now();
    const detail = fn();
    const ms = performance.now() - started;
    steps.push(
      `${label} ${detail ?? ""}${detail ? " " : ""}${ms.toFixed(0)}ms`,
    );
  };

  sqlite.transaction(() => {
    // v0 to v1: the columns, the claim, the triggers and the composites.
    // A database that already reads 1 has all of them.
    if (tenancyVersion < 1) {
      step("columns", () => {
        let added = 0;
        for (const table of OWNED_TABLES) {
          const columns = sqlite.pragma(`table_info(${table})`) as {
            name: string;
          }[];
          if (columns.length === 0) {
            throw new Error(
              `Cannot add ownerId: table "${table}" does not exist. §2z-4 must run after every owned table is created.`,
            );
          }
          if (!columns.some((c) => c.name === "ownerId")) {
            // A REFERENCES clause is legal on ADD COLUMN only when the default
            // is NULL, which is the semantics wanted anyway: existing rows are
            // unowned until the claim below runs. RESTRICT rather than CASCADE
            // on purpose — deleting an account that still owns contacts should
            // fail loudly, not delete the contacts.
            sqlite.exec(
              `ALTER TABLE ${table} ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT`,
            );
            added++;
          }
        }
        return `${added} added,`;
      });

      step("trigger drops", () => {
        for (const name of TRIGGERS_DROPPED_FOR_CLAIM) {
          sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`);
        }
        return `${TRIGGERS_DROPPED_FOR_CLAIM.length} dropped,`;
      });

      let owner = "";
      step("local owner", () => {
        owner = ensureLocalOwner();
        return "";
      });

      step("claim", () => {
        const claimed = claimUnownedData(owner);
        const total = Object.values(claimed).reduce((a, b) => a + b, 0);
        return total > 0
          ? `${Object.entries(claimed)
              .map(([t, n]) => `${n} ${t}`)
              .join(", ")},`
          : "nothing to claim,";
      });

      step("child backfill", () => {
        let rows = 0;
        for (const { table, key } of OWNER_CHILD_TABLES) {
          rows += sqlite
            .prepare(
              // tenant-lint: allow boot migration
              `UPDATE ${table} SET ownerId = (SELECT ownerId FROM contacts WHERE id = ${table}.${key})
                WHERE ownerId IS NULL`,
            )
            .run().changes;
        }
        return `${rows} rows,`;
      });

      step("invariant triggers", () => {
        sqlite.exec(ownerInvariantTriggerSql());
        return "";
      });

      step("composite indexes", () => {
        sqlite.exec(OWNER_COMPOSITE_INDEXES);
        return "";
      });
    }

    // v1 to v2: the prefix indexes go, now that the plan tests prove the
    // composites answer every owner-first read. DROP INDEX is metadata
    // only, so this is fast on any size of database.
    if (tenancyVersion < 2) {
      step("prefix index drops", () => {
        let dropped = 0;
        for (const name of OWNER_PREFIX_INDEXES) {
          const before = sqlite
            .prepare(
              `SELECT COUNT(*) AS n FROM sqlite_master
                WHERE type = 'index' AND name = ?`,
            )
            .get(name) as { n: number };
          sqlite.exec(`DROP INDEX IF EXISTS ${name}`);
          dropped += before.n;
        }
        // A fresh database never had them, so this reads 0 there rather than
        // claiming four drops that did nothing.
        return `${dropped} dropped,`;
      });
    }

    writeTenancyVersion(TENANCY_SCHEMA_VERSION);
  })();

  log.info(
    "Database",
    `Tenancy migration v${tenancyVersion} to v${TENANCY_SCHEMA_VERSION} in ${(performance.now() - migrationStarted).toFixed(0)}ms (${steps.join("; ")})`,
  );
}

// =============================================================================
// 2z-5. Uploads relocation
// =============================================================================
// Files move from the flat `uploads/avatars/` and `uploads/` directories into
// `uploads/u/<ownerId>/avatars/` and `uploads/u/<ownerId>/files/`, and the
// stored URL is rewritten to match. Outside every transaction, because it
// touches the filesystem: a rolled-back transaction cannot un-move a file.
//
// Position matters, and this is not where the plan put it. The plan ran the
// relocation last, calling the trigger it fires harmless. It is not. Rewriting
// `avatarUrl` fires `contacts_auto_updated_at`, which stamps `updatedAt`, and
// `findStaleEmbeddings` re-embeds every contact whose `updatedAt` is newer
// than its `embeddedAt`. Running it last meant every contact with an avatar
// was re-embedded through the paid provider on the next deep dedupe scan. The
// migration test caught it.
//
// Here, on a migrating boot, §2z-4 has just dropped those triggers and §3 to
// §6 have not yet put them back, so the rewrite stamps nothing. On any later
// boot the WHERE clauses match no rows, so no UPDATE runs at all and the
// question does not arise. `contacts.ownerId` exists by now, which is the
// other thing this step needs.
//
// Idempotent by its WHERE clauses — a URL that already points at `/uploads/u/`
// matches nothing. Nothing is ever deleted. A file no row references moves to
// `uploads/orphaned/` so an operator can look at it before deciding.
//
// The `/uploads` ownership guard is Phase 2a. Until then the new path is
// served to any authenticated caller, which is the exposure that exists today.
// =============================================================================

{
  const moved: string[] = [];
  const relocate = (
    fromAbs: string | null,
    ownerId: string,
    kind: "avatars" | "files",
    filename: string,
  ): void => {
    if (!fromAbs || !fs.existsSync(fromAbs)) return;
    const dir = ownerUploadDir(ownerId, kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(fromAbs, path.join(dir, filename));
  };

  const avatars = sqlite
    .prepare(
      `SELECT id, ownerId, avatarUrl FROM contacts WHERE avatarUrl LIKE '/uploads/avatars/%'`,
    )
    .all() as { id: string; ownerId: string; avatarUrl: string }[];

  const attachments = sqlite
    .prepare(
      `SELECT id, ownerId, fileUrl FROM interactions
        WHERE fileUrl LIKE '/uploads/%'
          AND fileUrl NOT LIKE '/uploads/u/%'
          AND fileUrl NOT LIKE '/uploads/logos/%'`,
    )
    .all() as { id: string; ownerId: string; fileUrl: string }[];

  if (avatars.length > 0 || attachments.length > 0) {
    const started = performance.now();
    // The database rewrite is one transaction; the file moves are not, and
    // run first. A file already at the new path with an un-rewritten URL is
    // recoverable. The reverse — a rewritten URL pointing at a file still in
    // the old place — is a broken image.
    for (const row of avatars) {
      const filename = path.basename(row.avatarUrl);
      relocate(
        resolveUploadPath(row.avatarUrl),
        row.ownerId,
        "avatars",
        filename,
      );
      moved.push(filename);
    }
    for (const row of attachments) {
      const filename = path.basename(row.fileUrl);
      relocate(resolveUploadPath(row.fileUrl), row.ownerId, "files", filename);
      moved.push(filename);
    }

    const setAvatar = sqlite.prepare(
      // tenant-lint: allow boot migration
      `UPDATE contacts SET avatarUrl = ? WHERE id = ?`,
    );
    const setFile = sqlite.prepare(
      // tenant-lint: allow boot migration
      `UPDATE interactions SET fileUrl = ? WHERE id = ?`,
    );
    sqlite.transaction(() => {
      // A missing source file still gets its URL rewritten. Leaving the old
      // URL would mean this block retries the same rows on every boot.
      for (const row of avatars) {
        setAvatar.run(
          ownerUploadUrl(row.ownerId, "avatars", path.basename(row.avatarUrl)),
          row.id,
        );
      }
      for (const row of attachments) {
        setFile.run(
          ownerUploadUrl(row.ownerId, "files", path.basename(row.fileUrl)),
          row.id,
        );
      }
    })();

    log.info(
      "Database",
      `Relocated ${avatars.length} avatar(s) and ${attachments.length} attachment(s) under uploads/u/ in ${(performance.now() - started).toFixed(0)}ms`,
    );
  }

  // Anything left flat that no row points at. `/api/avatar/...` and external
  // https:// avatars never had a file here, so they cannot orphan one.
  const orphanDir = path.join(UPLOADS_DIR, "orphaned");
  const sweep = (dir: string, referenced: Set<string>): number => {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || referenced.has(entry.name)) continue;
      fs.mkdirSync(orphanDir, { recursive: true });
      fs.renameSync(
        path.join(dir, entry.name),
        path.join(orphanDir, entry.name),
      );
      log.warn(
        "Database",
        `Moved unreferenced upload ${entry.name} to uploads/orphaned/`,
      );
      n++;
    }
    return n;
  };

  const referencedAvatars = new Set(
    (
      sqlite
        .prepare(
          // tenant-lint: allow boot migration
          `SELECT avatarUrl FROM contacts WHERE avatarUrl LIKE '/uploads/%'`,
        )
        .all() as { avatarUrl: string }[]
    ).map((r) => path.basename(r.avatarUrl)),
  );
  const referencedFiles = new Set(
    (
      sqlite
        .prepare(
          // tenant-lint: allow boot migration
          `SELECT fileUrl FROM interactions WHERE fileUrl LIKE '/uploads/%'`,
        )
        .all() as { fileUrl: string }[]
    ).map((r) => path.basename(r.fileUrl)),
  );

  const orphans =
    sweep(AVATARS_DIR, referencedAvatars) + sweep(UPLOADS_DIR, referencedFiles);
  if (orphans > 0) {
    log.warn(
      "Database",
      `${orphans} unreferenced upload(s) moved to uploads/orphaned/. Nothing was deleted.`,
    );
  }
}

// =============================================================================
// 2a. Data Migration — Retire stored api.dicebear.com avatar URLs
// =============================================================================
// Contacts created before avatars were generated locally carry an absolute
// `https://api.dicebear.com/9.x/<style>/svg?seed=...` URL in `avatarUrl`, so
// every render of those rows sent the contact's name to a third party. Rewrite
// them to the app's own route.
//
// Only the style and seed carry over. The old URLs also encoded expression and
// clothing parameters, but those are now applied server-side at render time —
// which is deliberate, because the old parameters constrained only the mouth
// and left `eyebrows` free, so some contacts scowled. Faces whose brows were
// angry will change; that is the point.
//
// Idempotent: the LIKE only matches URLs that have not been migrated, and an
// unknown style falls back to avataaars rather than producing a dead route.
// =============================================================================

try {
  const legacy = sqlite
    .prepare(
      // tenant-lint: allow boot migration
      "SELECT id, avatarUrl FROM contacts WHERE avatarUrl LIKE 'https://api.dicebear.com/%'",
    )
    .all() as { id: string; avatarUrl: string }[];

  if (legacy.length > 0) {
    const KNOWN_STYLES = new Set([
      "avataaars",
      "lorelei",
      "bottts",
      "initials",
    ]);
    const update = sqlite.prepare(
      // tenant-lint: allow boot migration
      "UPDATE contacts SET avatarUrl = ? WHERE id = ?",
    );
    const migrateAll = sqlite.transaction(
      (rows: { id: string; avatarUrl: string }[]) => {
        for (const row of rows) {
          let style = "avataaars";
          let seed = "";
          try {
            const url = new URL(row.avatarUrl);
            // Path shape: /9.x/<style>/svg
            const fromPath = url.pathname.split("/").filter(Boolean)[1];
            if (fromPath && KNOWN_STYLES.has(fromPath)) style = fromPath;
            seed = url.searchParams.get("seed") ?? "";
          } catch {
            // Unparseable URL — fall through to the name-seeded default below.
          }
          const params = new URLSearchParams({ seed });
          update.run(`/api/avatar/${style}?${params.toString()}`, row.id);
        }
      },
    );
    migrateAll(legacy.filter((row) => row.avatarUrl));
    log.info(
      "Database",
      `Migrated ${legacy.length} avatar URL(s) off api.dicebear.com to local generation`,
    );
  }
} catch (err) {
  log.warn(
    "Database",
    `Avatar URL migration skipped: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// =============================================================================
// 2b. Data Cleanup — Sanitize legacy AI Search artifacts
// =============================================================================
// These idempotent queries fix two issues in previously-hydrated contacts:
// 1. AI-search interests stored without isAiGenerated=1 (LLM didn't set the flag)
// 2. Experience/education dates stored as the literal string 'null'
// Both are safe to run on every startup — they're no-ops when nothing matches.
// =============================================================================

try {
  // Fix interests: any interest on a contact that has AI-search-sourced data
  // should be marked as AI-generated (it was inserted by the merge engine)
  const fixedInterests = sqlite
    .prepare(
      `
    UPDATE contact_interests SET isAiGenerated = 1
    WHERE isAiGenerated = 0
    AND contactId IN (SELECT DISTINCT contactId FROM contact_experience WHERE source = 'ai-search')
  `,
    )
    .run();
  if (fixedInterests.changes > 0) {
    log.info(
      "Database",
      `Fixed ${fixedInterests.changes} AI-search interests missing isAiGenerated flag`,
    );
  }

  // Scrub 'null' strings from experience dates
  const fixedExpStart = sqlite
    .prepare(
      `UPDATE contact_experience SET startDate = NULL WHERE startDate = 'null'`,
    )
    .run();
  const fixedExpEnd = sqlite
    .prepare(
      `UPDATE contact_experience SET endDate = NULL WHERE endDate = 'null'`,
    )
    .run();
  const fixedEduStart = sqlite
    .prepare(
      `UPDATE contact_education SET startDate = NULL WHERE startDate = 'null'`,
    )
    .run();
  const fixedEduEnd = sqlite
    .prepare(
      `UPDATE contact_education SET endDate = NULL WHERE endDate = 'null'`,
    )
    .run();
  const totalDateFixes =
    fixedExpStart.changes +
    fixedExpEnd.changes +
    fixedEduStart.changes +
    fixedEduEnd.changes;
  if (totalDateFixes > 0) {
    log.info(
      "Database",
      `Scrubbed ${totalDateFixes} 'null' string date value(s) from experience/education`,
    );
  }
} catch (err) {
  log.warn(
    "Database",
    `Data cleanup skipped: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// =============================================================================
// 3. FTS5 Full-Text Search Index
// =============================================================================
// FTS5 virtual tables are NOT managed by Drizzle ORM, so we maintain them
// here with explicit DDL. The index is rebuilt on every startup to ensure
// consistency with the current data.
//
// IMPORTANT: searchExpansion column must exist BEFORE FTS rebuild because
// the FTS backfill query references c.searchExpansion.
// =============================================================================

try {
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN searchExpansion TEXT`);
  log.info("Database", "Added searchExpansion column to contacts (pre-FTS)");
} catch {
  // Column already exists — expected on subsequent runs
}

// deletedAt must also exist before the FTS triggers below — they reference
// it to keep trashed contacts out of the search index.
try {
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN deletedAt TEXT`);
  log.info("Database", "Added deletedAt column to contacts (trash, pre-FTS)");
} catch {
  // Column already exists — expected on subsequent runs
}
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_contacts_deleted ON contacts(deletedAt)`,
);

// These columns must exist before the search migration on older installations.
for (const column of ["canonicalId TEXT", "isArchived INTEGER DEFAULT 0"]) {
  const name = column.split(" ")[0];
  const columns = sqlite.pragma("table_info(contacts)") as { name: string }[];
  if (!columns.some((c) => c.name === name))
    sqlite.exec(`ALTER TABLE contacts ADD COLUMN ${column}`);
}
installSearchIndex(sqlite);

// =============================================================================
// 4. Auto-stamp updatedAt on every contacts mutation
// =============================================================================
// Guarantees updatedAt is always current regardless of which code path
// (geocoder, archive toggle, bulk update, etc.) mutates the row.
// Uses AFTER UPDATE to avoid recursion — the trigger itself runs after
// the original UPDATE, and the SET updatedAt is a no-op if already current.
// =============================================================================

// tenant-lint: allow boot migration
sqlite.exec(`
  DROP TRIGGER IF EXISTS contacts_auto_updated_at;
  CREATE TRIGGER contacts_auto_updated_at AFTER UPDATE ON contacts
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE contacts SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;
`);

// =============================================================================
// 5. Auto-stamp updatedAt on every interactions mutation
// =============================================================================
// Same pattern as contacts — guarantees updatedAt is always current even when
// background processes (mention extraction, EML import re-parent, etc.) update rows.
// =============================================================================

// tenant-lint: allow boot migration
sqlite.exec(`
  DROP TRIGGER IF EXISTS interactions_auto_updated_at;
  CREATE TRIGGER interactions_auto_updated_at AFTER UPDATE ON interactions
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE interactions SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

  DROP TRIGGER IF EXISTS action_items_auto_updated_at;
  CREATE TRIGGER action_items_auto_updated_at AFTER UPDATE ON action_items
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE action_items SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;
`);

log.info(
  "Database",
  "updatedAt triggers installed (contacts, interactions, action_items)",
);

// =============================================================================
// 6. Action Items Table + Sync Triggers
// =============================================================================
// Creates the action_items table via raw DDL (Drizzle schema defines it for
// type-safety, but since we have no prod migrations, we ensure it exists here).
// Three triggers keep contacts.nextFollowUpAt in sync as a denormalized cache
// set to MIN(dueAt) of pending (non-completed) action items.
// =============================================================================

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    interactionId TEXT REFERENCES interactions(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    dueAt TEXT NOT NULL,
    completedAt TEXT,
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    updatedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE INDEX IF NOT EXISTS idx_action_items_contact ON action_items(contactId);
  CREATE INDEX IF NOT EXISTS idx_action_items_due ON action_items(dueAt) WHERE completedAt IS NULL;
`);

// tenant-lint: allow boot migration
sqlite.exec(`
  DROP TRIGGER IF EXISTS action_items_sync_insert;
  CREATE TRIGGER action_items_sync_insert AFTER INSERT ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = NEW.contactId AND completedAt IS NULL
    ) WHERE id = NEW.contactId;
  END;

  DROP TRIGGER IF EXISTS action_items_sync_update;
  CREATE TRIGGER action_items_sync_update AFTER UPDATE ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = NEW.contactId AND completedAt IS NULL
    ) WHERE id = NEW.contactId;
  END;

  DROP TRIGGER IF EXISTS action_items_sync_delete;
  CREATE TRIGGER action_items_sync_delete AFTER DELETE ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = OLD.contactId AND completedAt IS NULL
    ) WHERE id = OLD.contactId;
  END;
`);

log.info("Database", "action_items table + sync triggers installed");

// =============================================================================
// 7. Ensure relationshipScore column exists on contacts
// =============================================================================

try {
  sqlite.exec(
    `ALTER TABLE contacts ADD COLUMN relationshipScore INTEGER DEFAULT 50`,
  );
  log.info("Database", "Added relationshipScore column to contacts");
} catch {
  // Column already exists — expected on subsequent runs
}

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
// 9. Deduplication Engine Schema
// =============================================================================
// Adds columns for soft-merge + phonetic indexing, plus three new tables for
// the persistent suggestion system. All statements are idempotent.
// =============================================================================

// 9a. Soft-merge column: canonicalId points to the primary contact for merged dupes.
// NULL = active contact. Non-null = this contact has been subsumed.
try {
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN canonicalId TEXT`);
  log.info("Database", "Added canonicalId column to contacts");
} catch {
  // Column already exists — expected on subsequent runs
}

// 9b. Phonetic blocking index: Double Metaphone hash for O(1) phonetic lookups.
try {
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN phoneticHash TEXT`);
  log.info("Database", "Added phoneticHash column to contacts");
} catch {
  // Column already exists — expected on subsequent runs
}
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_contacts_phonetic ON contacts(phoneticHash)`,
);

// 9c. Persistent suggestion storage
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dedupe_suggestions (
    id TEXT PRIMARY KEY,
    contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    matchType TEXT NOT NULL,
    confidence REAL NOT NULL,
    reasoning TEXT NOT NULL,
    matchedField TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    reviewedAt TEXT,
    reviewedBy TEXT,
    UNIQUE(contactIdA, contactIdB)
  );
  CREATE INDEX IF NOT EXISTS idx_dedupe_status ON dedupe_suggestions(status);
  CREATE INDEX IF NOT EXISTS idx_dedupe_confidence ON dedupe_suggestions(confidence DESC);
`);

// 9d. Never-merge exclusions
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dedupe_exclusions (
    contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (contactIdA, contactIdB)
  );
`);

// 9e. Merge audit log
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dedupe_merge_log (
    id TEXT PRIMARY KEY,
    primaryId TEXT NOT NULL,
    duplicateId TEXT NOT NULL,
    mergedBy TEXT NOT NULL,
    mergeType TEXT NOT NULL,
    confidence REAL NOT NULL,
    reasoning TEXT NOT NULL,
    mergedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    undoneAt TEXT,
    duplicateSnapshot TEXT
  );
`);

log.info(
  "Database",
  "Dedupe schema ready (suggestions, exclusions, merge_log)",
);

// 9f. Contact embedding vector storage (requires sqlite-vec loaded above)
sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS contact_embeddings USING vec0(
    contactId TEXT PRIMARY KEY,
    ownerId TEXT PARTITION KEY,
    embedding FLOAT[768]
  );
`);

// 9f-b. Search embedding vector storage (local model, 384-dim)
// Separate from dedupe embeddings — optimized for search with local model
sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_embeddings USING vec0(
    contactId TEXT PRIMARY KEY,
    ownerId TEXT PARTITION KEY,
    embedding FLOAT[384]
  );
`);

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
function vecTableWidth(table: string): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
    .get(table) as { sql?: string } | undefined;
  return row?.sql?.match(/FLOAT\[(\d+)\]/)?.[1] ?? "unknown";
}

log.info(
  "Database",
  `contact_embeddings vec0 table ready (${vecTableWidth("contact_embeddings")}-dim, dedupe)`,
);
log.info(
  "Database",
  `search_embeddings vec0 table ready (${vecTableWidth("search_embeddings")}-dim, search)`,
);

// =============================================================================
// 9k. vec0 partition-key rebuild
// =============================================================================
// A table created before 2.0 has no partition key, and sqlite-vec refuses to
// add one: ALTER TABLE on a vec0 table returns OK, leaves the shadow tables
// under the old name, and the next read fails with "no such table". So the
// rows are read out, the table is dropped, a partitioned one is created at the
// same width, and the rows go back in. All inside one transaction per table.
//
// No embedding is recomputed. The stored `ai.embeddingsState` signature and
// dimension are untouched, so ensureEmbeddingStore and
// ensureDedupeEmbeddingStore see no change on the next boot and no provider
// API call happens.
// =============================================================================

/** vec0 tables and the DDL they must have. Pinned equal by a unit test. */
export function vecTableDdl(table: string, dimension: number): string {
  return `CREATE VIRTUAL TABLE ${table} USING vec0(
    contactId TEXT PRIMARY KEY,
    ownerId TEXT PARTITION KEY,
    embedding FLOAT[${dimension}]
  )`;
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

for (const table of ["search_embeddings", "contact_embeddings"]) {
  const ddl = (
    sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE name = ?`)
      .get(table) as { sql?: string } | undefined
  )?.sql;
  if (!ddl || /PARTITION KEY/i.test(ddl)) continue;

  const width = vecTableWidth(table);
  const dimension = Number.parseInt(width, 10);
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error(
      `Cannot rebuild ${table}: its DDL does not declare a vector width (read "${width}"). Refusing to guess a dimension.`,
    );
  }

  const started = performance.now();
  let copied = 0;
  let dropped = 0;
  sqlite.transaction(() => {
    // A row whose contact is gone is already an orphan. It is left behind
    // rather than given a NULL partition, which query 9 of the verification
    // script would then flag forever.
    const rows = sqlite
      .prepare(
        // tenant-lint: allow boot migration
        `SELECT e.contactId AS contactId, c.ownerId AS ownerId, e.embedding AS embedding
           FROM ${table} e JOIN contacts c ON c.id = e.contactId`,
      )
      .all() as { contactId: string; ownerId: string; embedding: Buffer }[];
    const total = (
      sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n;
    dropped = total - rows.length;

    sqlite.exec(`DROP TABLE ${table}`);
    sqlite.exec(vecTableDdl(table, dimension));

    const insert = sqlite.prepare(
      `INSERT INTO ${table} (contactId, ownerId, embedding) VALUES (?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(row.contactId, row.ownerId, row.embedding);
      copied++;
    }
  })();

  log.info(
    "Database",
    `Rebuilt ${table} with a partition key: ${copied} vectors copied at ${dimension} dim` +
      `${dropped > 0 ? `, ${dropped} orphan(s) dropped` : ""} in ${(performance.now() - started).toFixed(0)}ms`,
  );
}

// 9g. Embedding metadata: tracks when each contact was last embedded
//     Used for staleness detection — if contact.updatedAt > embeddedAt, re-embed
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dedupe_embedding_meta (
    contactId TEXT PRIMARY KEY,
    embeddedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);

// =============================================================================
// 9g2. App settings (key/value JSON)
// =============================================================================
// Backs AI capability configuration: provider keys entered through the UI,
// custom OpenAI-compatible endpoints, capability assignments, and cached
// model lists. See server/services/settingsService.ts.
// =============================================================================

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);

// =============================================================================
// 9i. Ownership guard
// =============================================================================
// The columns themselves are added in §2z-4, which has to run before §3
// because the FTS backfill selects `c.ownerId`. What stays here is the check
// that used to be implied by doing the work: if any owned table reached the
// end of boot without the column, every scoped query in Phase 2 would return
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
// 9h. Hot-path indexes
// =============================================================================
// Every contact hydration joins ~10 child tables on contactId, and the
// dashboard/zero-state/dedupe queries filter contacts on status columns.
// Without these, each lookup is a full table scan (only PK autoindexes and a
// few composite uniques existed). All idempotent via IF NOT EXISTS.
// =============================================================================

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON contact_emails(contactId);
  CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones(contactId);
  CREATE INDEX IF NOT EXISTS idx_contact_social_links_contact ON contact_social_links(contactId);
  CREATE INDEX IF NOT EXISTS idx_contact_education_contact ON contact_education(contactId);
  CREATE INDEX IF NOT EXISTS idx_contact_experience_contact ON contact_experience(contactId);
  CREATE INDEX IF NOT EXISTS idx_contact_sources_contact ON contact_sources(contactId);
  CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contactId);
  CREATE INDEX IF NOT EXISTS idx_interactions_contact ON interactions(contactId);
  CREATE INDEX IF NOT EXISTS idx_interaction_mentions_contact ON interaction_mentions(contactId);
  CREATE INDEX IF NOT EXISTS idx_list_members_contact ON list_members(contactId);
  CREATE INDEX IF NOT EXISTS idx_contacts_canonical ON contacts(canonicalId);
  CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(isGhost, isArchived, canonicalId);
  CREATE INDEX IF NOT EXISTS idx_contacts_last_contacted ON contacts(lastContactedAt);
  CREATE INDEX IF NOT EXISTS idx_contacts_added ON contacts(addedAt);
  CREATE INDEX IF NOT EXISTS idx_contacts_score ON contacts(relationshipScore);
`);

// Give the query planner statistics for the new indexes.
//
// ANALYZE is new in Phase 1. `PRAGMA optimize` only re-analyzes tables that
// already have sqlite_stat1 rows, and nothing had ever run ANALYZE, so the
// owner-first composite indexes above would have been invisible to the
// planner. This runs once per boot and is cheap on a database this size.
sqlite.exec("ANALYZE");
sqlite.pragma("optimize");

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

installSearchVectorTriggers(sqlite);
