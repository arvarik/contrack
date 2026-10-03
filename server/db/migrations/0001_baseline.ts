// =============================================================================
// Migration 0001_baseline
// =============================================================================
// The boot DDL and data fixes that server/db.ts and
// server/services/geocoding/cache.ts ran on every start up to v2.0 at
// d67c8a9, moved here in the order they ran. A database runs them once: a new
// database to build its schema, and a d67c8a9 database to converge the way
// every boot used to make it converge. Both end at the schema in
// tests/fixtures/schema/v2.0-d67c8a9.sql, and
// tests/integration/db.migrations.test.ts compares the stored SQL byte for
// byte. So the text inside every template literal here is the old text, and
// the code around it is the old code, split into one function per section.
//
// What changed, and why:
//
// - Drizzle's folder is gone. The three SQL files are embedded below, and
//   drizzleMigrations applies them by the journal rule drizzle-orm 0.45 used.
// - The lists the tenancy section reads are frozen copies, as they were at
//   d67c8a9. server/db.ts keeps the live OWNED_TABLES, which later
//   migrations extend.
// - The tenancy version lives in schema_migrations (an `index` row named
//   `tenancy`). The gate falls back to app_settings `schema.tenancy` only
//   when that row is missing.
// - The derived structures (the FTS tables, the vec0 stores, the passage
//   index and the search vector triggers) are not here. Their installers run
//   on every boot, after the migrations (server/db/indexes.ts).
// - Four steps stay on every boot in server/db.ts, because live code needs
//   them: the nextFollowUpAt backfill (§8), the ownership guard (§9i),
//   ANALYZE with PRAGMA optimize, and the phonetic hash backfill (§10).
//
// The parameter keeps the name `sqlite`, so the moved code reads as it did.
// Never edit this file. A change to the schema is a new migration
// (`npm run db:new <name>`).
// =============================================================================

import type Database from "better-sqlite3";
import crypto from "crypto";
import { log } from "../../utils/logger.ts";
import { defaultAvatarUrl, isDefaultAvatarFor } from "../../utils/avatarUrl.ts";
import {
  backfillMentionRows,
  contactEditColumns,
  deleteRetiredSettings,
} from "../helpers.ts";
import { ensureLocalOwner } from "../owners.ts";
import { readIndexVersion, recordIndexVersion } from "../runner.ts";

export function up(sqlite: Database.Database): void {
  drizzleMigrations(sqlite);
  identity(sqlite);
  contactsColumns(sqlite);
  usersColumns(sqlite);
  identityTables(sqlite);
  dedupeTables(sqlite);
  importTables(sqlite);
  tenancy(sqlite);
  pronounAvatars(sqlite);
  aiSearchCleanup(sqlite);
  contactsSearchColumns(sqlite);
  contactsTriggers(sqlite);
  interactionsTriggers(sqlite);
  actionItems(sqlite);
  phoneticIndex(sqlite);
  dedupeEmbeddingMeta(sqlite);
  retiredSettings(sqlite);
  hotPathIndexes(sqlite);
  mentionRows(sqlite);
  geocodeCache(sqlite);
}

// =============================================================================
// 2. Drizzle Migrations
// =============================================================================
// drizzle/0000 to 0002 as the files were, byte for byte: the hash in
// `__drizzle_migrations` is the SHA-256 of the file text. drizzle-orm 0.45
// created its table with the DDL below, read the newest `created_at`, ran
// every migration whose journal `when` is newer, one statement per
// `--> statement-breakpoint`, and inserted (hash, created_at) for each. This
// does the same, without its BEGIN and COMMIT: the runner's transaction holds
// it. Nothing reads the table afterwards.
// =============================================================================

/** drizzle-orm 0.45's DDL for its table, as it sent it. */
const DRIZZLE_TABLE = `
			CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric
			)
		`;

/** The three files of drizzle/, with the journal's `when` for each. */
const DRIZZLE_MIGRATIONS: { tag: string; when: number; sql: string }[] = [
  {
    tag: "0000_soft_silver_sable",
    when: 1775690197662,
    sql: `CREATE TABLE \`action_items\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`interactionId\` text,
	\`title\` text NOT NULL,
	\`dueAt\` text NOT NULL,
	\`completedAt\` text,
	\`createdAt\` text DEFAULT (CURRENT_TIMESTAMP),
	\`updatedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`interactionId\`) REFERENCES \`interactions\`(\`id\`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE \`contact_addresses\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`address\` text NOT NULL,
	\`label\` text DEFAULT 'home',
	\`isPrimary\` integer DEFAULT 0,
	\`sortOrder\` integer DEFAULT 0,
	\`source\` text,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`contact_addresses_contactId_address_unique\` ON \`contact_addresses\` (\`contactId\`,\`address\`);--> statement-breakpoint
CREATE TABLE \`contact_attributes\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`name\` text NOT NULL,
	\`value\` text NOT NULL,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`contact_attributes_contactId_name_unique\` ON \`contact_attributes\` (\`contactId\`,\`name\`);--> statement-breakpoint
CREATE TABLE \`contact_education\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`school\` text NOT NULL,
	\`degree\` text,
	\`fieldOfStudy\` text,
	\`startDate\` text,
	\`endDate\` text,
	\`description\` text,
	\`source\` text,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`contact_emails\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`email\` text NOT NULL,
	\`label\` text DEFAULT 'personal',
	\`isPrimary\` integer DEFAULT 0,
	\`sortOrder\` integer DEFAULT 0,
	\`source\` text,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`contact_experience\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`company\` text NOT NULL,
	\`role\` text,
	\`startDate\` text,
	\`endDate\` text,
	\`isCurrent\` integer DEFAULT 0,
	\`description\` text,
	\`location\` text,
	\`source\` text,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`contact_interests\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`interest\` text NOT NULL,
	\`isAiGenerated\` integer DEFAULT false,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`contact_interests_contactId_interest_unique\` ON \`contact_interests\` (\`contactId\`,\`interest\`);--> statement-breakpoint
CREATE TABLE \`contact_phones\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`phone\` text NOT NULL,
	\`label\` text DEFAULT 'mobile',
	\`isPrimary\` integer DEFAULT 0,
	\`sortOrder\` integer DEFAULT 0,
	\`source\` text,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`contact_social_links\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`platform\` text NOT NULL,
	\`url\` text NOT NULL,
	\`handle\` text,
	\`source\` text,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`contact_sources\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`platform\` text NOT NULL,
	\`externalId\` text,
	\`connectedOn\` text,
	\`importedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	\`rawData\` text,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`contact_tags\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`tag\` text NOT NULL,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`contacts\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`firstName\` text,
	\`lastName\` text,
	\`headline\` text,
	\`role\` text,
	\`company\` text,
	\`location\` text,
	\`birthday\` text,
	\`preferences\` text,
	\`avatarUrl\` text,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	\`updatedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	\`cadenceDays\` integer DEFAULT 90,
	\`lastContactedAt\` text,
	\`nextFollowUpAt\` text,
	\`themeColor\` text DEFAULT 'brand',
	\`about\` text,
	\`pronouns\` text,
	\`industry\` text,
	\`website\` text,
	\`lat\` real,
	\`lng\` real,
	\`aiBriefing\` text,
	\`aiBackground\` text,
	\`aiSummary\` text,
	\`aiHydratedAt\` text,
	\`aiBriefingAt\` text,
	\`isGhost\` integer DEFAULT 0,
	\`isArchived\` integer DEFAULT 0,
	\`relationshipScore\` integer DEFAULT 50
);
--> statement-breakpoint
CREATE TABLE \`interaction_mentions\` (
	\`interactionId\` text NOT NULL,
	\`contactId\` text NOT NULL,
	PRIMARY KEY(\`interactionId\`, \`contactId\`),
	FOREIGN KEY (\`interactionId\`) REFERENCES \`interactions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`interactions\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`type\` text NOT NULL,
	\`title\` text NOT NULL,
	\`content\` text,
	\`date\` text DEFAULT (CURRENT_TIMESTAMP),
	\`duration\` text,
	\`fileUrl\` text,
	\`fileName\` text,
	\`fileType\` text,
	\`source\` text,
	\`mentions\` text,
	\`updatedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`list_members\` (
	\`listId\` text NOT NULL,
	\`contactId\` text NOT NULL,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	PRIMARY KEY(\`listId\`, \`contactId\`),
	FOREIGN KEY (\`listId\`) REFERENCES \`lists\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`lists\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`icon\` text DEFAULT 'star' NOT NULL,
	\`sortOrder\` integer DEFAULT 0 NOT NULL,
	\`createdAt\` text DEFAULT (CURRENT_TIMESTAMP)
);
`,
  },
  {
    tag: "0001_spicy_mulholland_black",
    when: 1776211562913,
    sql: `CREATE TABLE IF NOT EXISTS \`ai_invocations\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`operation\` text NOT NULL,
	\`model\` text,
	\`tokenCount\` integer,
	\`latencyMs\` integer NOT NULL,
	\`cached\` integer DEFAULT 0 NOT NULL,
	\`description\` text,
	\`createdAt\` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS \`idx_ai_invocations_created\` ON \`ai_invocations\` (\`createdAt\` DESC);`,
  },
  {
    tag: "0002_wise_skrulls",
    when: 1790620180973,
    sql: `-- Existing v2 tables use guarded migrations in server/db.ts.
-- This migration adds only the new search evidence tables.
CREATE TABLE \`search_passage_state\` (
	\`contactId\` text PRIMARY KEY NOT NULL,
	\`ownerId\` text NOT NULL,
	\`representationVersion\` integer NOT NULL,
	\`fingerprint\` text NOT NULL,
	\`signature\` text NOT NULL,
	\`indexedAt\` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`idx_search_passage_state_owner\` ON \`search_passage_state\` (\`ownerId\`);
--> statement-breakpoint
CREATE TABLE \`search_passages\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`ownerId\` text NOT NULL,
	\`field\` text NOT NULL,
	\`sourceId\` text NOT NULL,
	\`sourceHash\` text NOT NULL,
	\`active\` integer DEFAULT 1 NOT NULL,
	\`context\` text NOT NULL,
	\`startOffset\` integer NOT NULL,
	\`endOffset\` integer NOT NULL,
	\`text\` text NOT NULL,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`idx_search_passages_contact\` ON \`search_passages\` (\`contactId\`);
--> statement-breakpoint
CREATE INDEX \`idx_search_passages_owner\` ON \`search_passages\` (\`ownerId\`);
`,
  },
];

function drizzleMigrations(sqlite: Database.Database): void {
  sqlite.prepare(DRIZZLE_TABLE).run();
  const last = sqlite
    .prepare(
      `SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`,
    )
    .raw()
    .get() as unknown[] | undefined;
  for (const migration of DRIZZLE_MIGRATIONS) {
    if (!last || Number(last[2]) < migration.when) {
      for (const statement of migration.sql.split("--> statement-breakpoint")) {
        sqlite.prepare(statement).run();
      }
      sqlite
        .prepare(
          `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES(?, ?)`,
        )
        .run(
          crypto.createHash("sha256").update(migration.sql).digest("hex"),
          migration.when,
        );
    }
  }
  log.info("Database", "Drizzle migrations applied successfully");
}

// =============================================================================
// 2z. Identity — users, sessions, and data ownership
// =============================================================================
// Declared in the boot code rather than as a Drizzle migration for the same
// reason `app_settings` is (§2z-2): it was the one place guaranteed to run
// before any query, and the DDL is trivially idempotent. The tables are
// mirrored in server/db/schema.ts so the rest of the app gets Drizzle types.
//
// See the OWNERSHIP note in server/db/schema.ts for what `ownerId` means and
// why only four tables carry it.
// =============================================================================
function identity(sqlite: Database.Database): void {
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
    lastLoginAt TEXT,
    avatarUrl TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    userAgent TEXT,
    method TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
`);

  const sessionCols = sqlite.pragma("table_info(sessions)") as {
    name: string;
  }[];
  if (!sessionCols.some((c) => c.name === "method")) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN method TEXT");
    log.info("Database", "Added method column to sessions");
  }

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
}

// =============================================================================
// 2z-0. Contacts columns the tenancy block indexes
// =============================================================================
// §2z-4 builds composite indexes over these columns, so on a fresh database
// they have to exist by then. Drizzle `0000` ships `isArchived` and
// `relationshipScore` but not `deletedAt`, `canonicalId`, `phoneticHash` or
// `searchExpansion`. Each column is added once, here, and only when it is
// missing.
//
// `geoSource` is not indexed by anything. It lives in this loop because it is
// the one place a contacts column is added once, by name, and guarded.
//
// `isTracked` says a person chose to keep up with this contact. Only a
// tracked contact is scored, appears on Pulse, or is tinted on the map.
// `trackedAt` is the moment the flag last turned on, written by the two
// `contacts_track_stamp_*` triggers in §4 and by nothing else. It is the
// clock for a tracked contact nobody has logged a note on yet.
//
// `aiResearch` is the contact's research record: every enrichment, what it
// added, the facts it reported and the pages it cited, as JSON in the shape
// of shared/researchRecord.ts. Only the enrichment merge writes it.
// =============================================================================
function contactsColumns(sqlite: Database.Database): void {
  for (const column of [
    "searchExpansion TEXT",
    "deletedAt TEXT",
    "canonicalId TEXT",
    "isArchived INTEGER DEFAULT 0",
    "phoneticHash TEXT",
    "relationshipScore INTEGER DEFAULT 50",
    "geoSource TEXT",
    "isTracked INTEGER NOT NULL DEFAULT 0",
    "trackedAt TEXT",
    "aiResearch TEXT",
  ]) {
    const name = column.split(" ")[0];
    const columns = sqlite.pragma("table_info(contacts)") as { name: string }[];
    if (!columns.some((c) => c.name === name)) {
      sqlite.exec(`ALTER TABLE contacts ADD COLUMN ${column}`);
      log.info("Database", `Added ${name} column to contacts (pre-tenancy)`);
    }
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
function usersColumns(sqlite: Database.Database): void {
  for (const column of [
    "status TEXT NOT NULL DEFAULT 'active'",
    "credentialState TEXT NOT NULL DEFAULT 'password'",
    "mustChangePassword INTEGER NOT NULL DEFAULT 0",
    "passwordChangedAt TEXT",
    "disabledAt TEXT",
    "createdBy TEXT REFERENCES users(id) ON DELETE SET NULL",
    "avatarUrl TEXT",
  ]) {
    const name = column.split(" ")[0];
    const columns = sqlite.pragma("table_info(users)") as { name: string }[];
    if (!columns.some((c) => c.name === name)) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN ${column}`);
      log.info("Database", `Added ${name} column to users`);
    }
  }
}

// =============================================================================
// 2z-2. Identity tables
// =============================================================================
// `app_settings` is created here because §2z-4 stores the tenancy schema
// version in it. It also backs the AI configuration: provider keys entered
// through the UI, custom OpenAI-compatible endpoints, capability assignments
// and cached model lists (see server/services/settingsService.ts). `PRAGMA user_version` already holds FTS_SCHEMA_VERSION and is
// a single 32-bit field, so a second migration cannot share that slot.
//
// `api_tokens`, `invitations`, `user_settings` and `audit_log` are created here
// so that one migration touches `users` once, and so `attachPrincipal` can look up a
// personal token.
// =============================================================================
function identityTables(sqlite: Database.Database): void {
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
    revokedAt TEXT,
    readOnly INTEGER NOT NULL DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    publicKey BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    deviceType TEXT NOT NULL DEFAULT 'singleDevice',
    backedUp INTEGER NOT NULL DEFAULT 0,
    aaguid TEXT,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    lastUsedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(userId);

  CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    userId TEXT REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expiresAt);

  CREATE TABLE IF NOT EXISTS auth_links (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tokenHash TEXT NOT NULL UNIQUE,
    createdBy TEXT REFERENCES users(id) ON DELETE SET NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL,
    usedAt TEXT,
    requestIp TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_auth_links_user ON auth_links(userId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_auth_links_cleanup ON auth_links(expiresAt, usedAt);
`);

  // `readOnly` came after the table. A token made before it reads and writes,
  // which is what every token did then, so the default is 0.
  const tokenCols = sqlite.pragma("table_info(api_tokens)") as {
    name: string;
  }[];
  if (!tokenCols.some((c) => c.name === "readOnly")) {
    sqlite.exec(
      "ALTER TABLE api_tokens ADD COLUMN readOnly INTEGER NOT NULL DEFAULT 0",
    );
    log.info("Database", "Added readOnly column to api_tokens");
  }
}

// =============================================================================
// 2z-3. Dedupe tables
// =============================================================================
// Created here because §2z-4 adds `ownerId` to every owned table and three of
// them are these.
// =============================================================================
function dedupeTables(sqlite: Database.Database): void {
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
}

// =============================================================================
// 2z-3b. Imports — one durable record per bulk import
// =============================================================================
// A bulk import used to exist only for the life of its request. A connection
// that dropped part way left the browser with no way to learn what happened,
// and a second attempt created every contact again under fresh ids. The
// record here is what the browser reconnects to, and what makes a second
// request with the same id a question rather than a second import.
//
// `imports` carries an owner of its own and is in OWNED_TABLES: it hangs off
// nothing, so the caller supplies the owner and the required-owner trigger
// refuses a row without one. `import_rows` hangs off `imports` and reaches its
// owner through that join, the way `list_members` reaches one through `lists`.
// It keeps a row's payload only while the row is failed, so a retry can run it
// again without the browser re-sending the file.
//
// Created here, before §2z-4, because the claim loop below walks every owned
// table and the table has to exist for the statement to prepare.
// =============================================================================
function importTables(sqlite: Database.Database): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'running',
    phase TEXT,
    message TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    autoMerged INTEGER,
    needsReview INTEGER,
    newUnique INTEGER,
    error TEXT,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    completedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_imports_owner_created ON imports(ownerId, createdAt DESC);

  CREATE TABLE IF NOT EXISTS import_rows (
    importId TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    rowIndex INTEGER NOT NULL,
    status TEXT NOT NULL,
    contactId TEXT,
    name TEXT,
    error TEXT,
    payload TEXT,
    PRIMARY KEY (importId, rowIndex)
  );
  CREATE INDEX IF NOT EXISTS idx_import_rows_status ON import_rows(importId, status);

  CREATE TABLE IF NOT EXISTS score_snapshots (
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    weekStart TEXT NOT NULL,
    score REAL NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (contactId, weekStart)
  );
  CREATE INDEX IF NOT EXISTS idx_score_snapshots_owner_week ON score_snapshots(ownerId, weekStart);

  CREATE TABLE IF NOT EXISTS search_history (
    id              TEXT PRIMARY KEY,
    ownerId         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    mode            TEXT NOT NULL,
    query           TEXT NOT NULL,
    normalizedQuery TEXT NOT NULL,
    resultCount     INTEGER,
    resultIds       TEXT,
    fallback        INTEGER NOT NULL DEFAULT 0,
    pinned          INTEGER NOT NULL DEFAULT 0,
    runCount        INTEGER NOT NULL DEFAULT 1,
    createdAt       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    lastRunAt       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (ownerId, mode, normalizedQuery)
  );
  CREATE INDEX IF NOT EXISTS idx_search_history_owner_last
    ON search_history (ownerId, lastRunAt DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_search_history_owner_mode_last
    ON search_history (ownerId, mode, lastRunAt DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_search_history_owner_pinned
    ON search_history (ownerId, pinned, lastRunAt DESC, id DESC);

  CREATE TABLE IF NOT EXISTS connectors (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    config TEXT NOT NULL DEFAULT '{}',
    secret TEXT,
    cursor TEXT,
    intervalMinutes INTEGER NOT NULL DEFAULT 30,
    attempts INTEGER NOT NULL DEFAULT 0,
    nextRunAt TEXT,
    lastRunAt TEXT,
    lastError TEXT,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_connectors_owner ON connectors(ownerId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_connectors_due ON connectors(status, nextRunAt);

  CREATE TABLE IF NOT EXISTS connector_runs (
    id TEXT PRIMARY KEY,
    connectorId TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    startedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    finishedAt TEXT,
    stats TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_connector_runs_conn ON connector_runs(connectorId, startedAt DESC);

  CREATE TABLE IF NOT EXISTS connector_links (
    connectorId TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    externalId TEXT NOT NULL,
    localId TEXT,
    seenCount INTEGER NOT NULL DEFAULT 1,
    lastSeenAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    ignoredAt TEXT,
    PRIMARY KEY (connectorId, kind, externalId)
  );
  CREATE INDEX IF NOT EXISTS idx_connector_links_local ON connector_links(localId);

  CREATE TABLE IF NOT EXISTS upcoming_events (
    connectorId TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    externalId TEXT NOT NULL,
    title TEXT NOT NULL,
    startsAt TEXT NOT NULL,
    endsAt TEXT NOT NULL,
    participants TEXT NOT NULL,
    contactIds TEXT NOT NULL,
    PRIMARY KEY (connectorId, externalId)
  );
  CREATE INDEX IF NOT EXISTS idx_upcoming_owner_start ON upcoming_events(ownerId, startsAt);

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    codeVerifier TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS map_views (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    layer TEXT NOT NULL DEFAULT 'pins',
    bounds TEXT NOT NULL,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_map_views_owner ON map_views(ownerId, sortOrder, name);
`);
}

// =============================================================================
// 2z-4. Tenancy — ownership columns and the local owner
// =============================================================================
// This block gives every owned table an `ownerId` column, creates the local
// owner, and installs the triggers and indexes that keep every owner true. It
// has to run here, before §3: the FTS backfill selects `c.ownerId`. A SELECT
// inside `exec` is prepared before it runs, so a missing column fails the boot
// even on an empty database. The column must exist first.
//
// Order inside the transaction is fixed: columns, local owner, invariant
// triggers, composite indexes, version write.
//
// The version and the four lists below are frozen copies, as they were at
// d67c8a9. A later migration that adds an owned table writes its own column,
// trigger and index, and server/db.ts keeps the live OWNED_TABLES.
// =============================================================================
/**
 * The tenancy schema version this migration writes. A database that reads
 * less runs the tenancy block. Version 1 added the ownership columns, the
 * invariant triggers and the composite indexes.
 */
const TENANCY_SCHEMA_VERSION = 2;
/** Tables that carry `ownerId`. Every row in each has an owner after boot. */
const OWNED_TABLES = [
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
] as const;

/** Owned tables with no parent contact. The caller must supply the owner. */
const OWNER_REQUIRED_TABLES = [
  "contacts",
  "lists",
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
 * The tenancy migration this database has reached: the `tenancy` row of
 * schema_migrations, or, when that row is missing, `schema.tenancy` in
 * `app_settings`, where every build before the ledger kept it.
 */
function readTenancyVersion(sqlite: Database.Database): number {
  const recorded = readIndexVersion(sqlite, "tenancy");
  if (recorded !== undefined) return recorded;
  try {
    const row = sqlite
      .prepare(`SELECT value FROM app_settings WHERE key = 'schema.tenancy'`)
      .get() as { value: string } | undefined;
    if (!row) return 0;
    const parsed = Number(JSON.parse(row.value));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // No app_settings table yet, which means a fresh database. The tenancy
    // migration has not run.
    return 0;
  }
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

  // No 2.0 code changes an owner. This trigger is here for a future "reassign
  // data" admin action. It cannot touch the vec0 tables: sqlite-vec refuses an
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

/** Composite indexes for the owner-first reads in tenant-scoped queries. */
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
function tenancy(sqlite: Database.Database): void {
  const tenancyVersion = readTenancyVersion(sqlite);
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
      // The columns, the local owner, the triggers and the composites. A
      // database that already reads 1 or more has all of them.
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
              // is NULL, which is the semantics wanted anyway. RESTRICT rather
              // than CASCADE on purpose: deleting an account that still owns
              // contacts should fail loudly, not delete the contacts.
              sqlite.exec(
                `ALTER TABLE ${table} ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT`,
              );
              added++;
            }
          }
          return `${added} added,`;
        });

        step("local owner", () => {
          ensureLocalOwner(sqlite);
          return "";
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

      recordIndexVersion(sqlite, "tenancy", TENANCY_SCHEMA_VERSION);
    })();

    log.info(
      "Database",
      `Tenancy migration v${tenancyVersion} to v${TENANCY_SCHEMA_VERSION} in ${(performance.now() - migrationStarted).toFixed(0)}ms (${steps.join("; ")})`,
    );
  } else {
    // A d67c8a9 database: its version came from app_settings, and the ledger
    // holds it from now on.
    recordIndexVersion(sqlite, "tenancy", tenancyVersion);
  }
}

// =============================================================================
// 2a-1. Data Migration — Default avatars follow the contact's pronouns
// =============================================================================
// The default face used to come from the name alone. It now reads the
// pronouns first, and a pronoun reaches the avatar route only through the
// URL's `look` parameter. Rows created before that carry a default URL with
// no `look`, so give them one.
//
// Only a contact that still wears the default avatar for its own name is
// touched: a face picked in the avatar picker and a photo stay as they are.
// Idempotent: a row already carrying the right look writes nothing, so after
// the first boot the UPDATE never runs. On that first boot the edit trigger
// stamps `updatedAt` on the rows it redraws, as an edit would. Only contacts
// with pronouns are candidates, so that is a small batch, once.
// =============================================================================
function pronounAvatars(sqlite: Database.Database): void {
  try {
    const withPronouns = sqlite
      .prepare(
        // tenant-lint: allow boot migration
        "SELECT id, name, pronouns, avatarUrl FROM contacts WHERE pronouns IS NOT NULL AND avatarUrl LIKE '/api/avatar/avataaars?%'",
      )
      .all() as {
      id: string;
      name: string;
      pronouns: string;
      avatarUrl: string;
    }[];

    const stale = withPronouns
      .filter((row) => isDefaultAvatarFor(row.avatarUrl, row.name))
      .map((row) => ({
        id: row.id,
        next: defaultAvatarUrl(row.name, row.pronouns),
        current: row.avatarUrl,
      }))
      .filter((row) => row.next !== row.current);

    if (stale.length > 0) {
      const update = sqlite.prepare(
        // tenant-lint: allow boot migration
        "UPDATE contacts SET avatarUrl = ? WHERE id = ?",
      );
      sqlite.transaction(() => {
        for (const row of stale) update.run(row.next, row.id);
      })();
      log.info(
        "Database",
        `Redrew ${stale.length} default avatar(s) from the contact's pronouns`,
      );
    }
  } catch (err) {
    log.warn(
      "Database",
      `Pronoun avatar migration skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// =============================================================================
// 2b. Data Cleanup — Sanitize legacy AI Search artifacts
// =============================================================================
// These idempotent queries fix two issues in previously-hydrated contacts:
// 1. AI-search interests stored without isAiGenerated=1 (LLM didn't set the flag)
// 2. Experience/education dates stored as the literal string 'null'
// Both are safe to run on every startup — they're no-ops when nothing matches.
// =============================================================================
function aiSearchCleanup(sqlite: Database.Database): void {
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
}

// =============================================================================
// 3. FTS5 Full-Text Search Index
// =============================================================================
// The FTS tables themselves are derived structures. installSearchIndex builds
// them on every boot, after the migrations (server/db/indexes.ts). What stays
// here is the index and the column that §3 made before it.
//
// The FTS backfill query and the FTS triggers name `searchExpansion` and
// `deletedAt`. §2z-0 has added both by now.
// =============================================================================
function contactsSearchColumns(sqlite: Database.Database): void {
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_contacts_deleted ON contacts(deletedAt)`,
  );

  // `scoreDirty` is here rather than in §2z-0 because §4 below builds its trigger
  // from the column list and has to see it.
  {
    const columns = sqlite.pragma("table_info(contacts)") as { name: string }[];
    if (!columns.some((c) => c.name === "scoreDirty")) {
      sqlite.exec(
        `ALTER TABLE contacts ADD COLUMN scoreDirty INTEGER NOT NULL DEFAULT 1`,
      );
    }
  }
}

// =============================================================================
// 4. Auto-stamp updatedAt, and mark a contact for re-scoring
// =============================================================================
// Guarantees updatedAt is always current regardless of which code path
// (geocoder, archive toggle, bulk update, etc.) mutates the row.
// Uses AFTER UPDATE to avoid recursion — the trigger itself runs after
// the original UPDATE, and the SET updatedAt is a no-op if already current.
//
// BOTH TRIGGERS LIST THEIR COLUMNS. A bare `AFTER UPDATE ON contacts` fires
// for any write, and two writes on this table are not edits: the hourly
// relationship score and the dirty flag that schedules it. With the broad
// trigger the hourly sweep stamped `updatedAt` on every contact in the
// instance, every hour. Three things followed from that:
//
//   • `updatedAt` stopped meaning "when this contact was last edited" and
//     started meaning "the last sweep". Measured on 10,000 contacts: every
//     row's `updatedAt` moved on every pass.
//   • `findStaleEmbeddings` re-embeds any contact whose `updatedAt` is newer
//     than its `embeddedAt`, so the next dedupe scan re-embedded the whole
//     corpus through the configured provider.
//   • Story S10 cannot work at all. "Score only what changed" needs a signal
//     that scoring does not itself set.
//
// The column list is derived from the table at the moment this runs, which
// is once. A later migration that adds a contacts column must drop and
// create these two triggers again with the new list.
// `tests/integration/scoring.incremental.test.ts` asserts the list is exactly
// the table minus SCORE_COLUMNS, so it fails when one does not.
// =============================================================================
function contactsTriggers(sqlite: Database.Database): void {
  const editColumnList = contactEditColumns(sqlite)
    .map((name) => `"${name}"`)
    .join(", ");

  // tenant-lint: allow boot migration
  sqlite.exec(`
  DROP TRIGGER IF EXISTS contacts_auto_updated_at;
  CREATE TRIGGER contacts_auto_updated_at
  AFTER UPDATE OF ${editColumnList} ON contacts
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE contacts SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

  DROP TRIGGER IF EXISTS contacts_score_dirty;
  CREATE TRIGGER contacts_score_dirty
  AFTER UPDATE OF ${editColumnList} ON contacts
  FOR EACH ROW
  WHEN NEW.scoreDirty = 0
  BEGIN
    UPDATE contacts SET scoreDirty = 1 WHERE id = NEW.id;
  END;
`);

  // The hourly sweep reads this and nothing else. A partial index holds only the
  // dirty rows, so an instance with nothing to do pays for an empty index scan
  // rather than a scan of every contact it has.
  // tenant-lint: allow boot migration
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_contacts_score_dirty
     ON contacts(ownerId) WHERE scoreDirty = 1`,
  );

  // `trackedAt` is stamped here, in the database, so a route, an MCP tool, a
  // merge and an import all record the moment the same way and none of them
  // can forget. A flag that turns on takes the time; a flag that turns off
  // clears it. A row born tracked takes the time on insert.
  //
  // `isTracked` is an edit column, so the two triggers above already stamp
  // `updatedAt` and mark the row for scoring when it flips. These two only add
  // the clock.
  // tenant-lint: allow boot migration
  sqlite.exec(`
  DROP TRIGGER IF EXISTS contacts_track_stamp_ins;
  CREATE TRIGGER contacts_track_stamp_ins
  AFTER INSERT ON contacts
  FOR EACH ROW
  WHEN NEW.isTracked = 1 AND NEW.trackedAt IS NULL
  BEGIN
    UPDATE contacts SET trackedAt = datetime('now') WHERE id = NEW.id;
  END;

  DROP TRIGGER IF EXISTS contacts_track_stamp_upd;
  CREATE TRIGGER contacts_track_stamp_upd
  AFTER UPDATE OF isTracked ON contacts
  FOR EACH ROW
  WHEN NEW.isTracked != OLD.isTracked
  BEGIN
    UPDATE contacts
       SET trackedAt = CASE WHEN NEW.isTracked = 1 THEN datetime('now') ELSE NULL END
     WHERE id = NEW.id;
  END;
`);

  // Every reader of the score and Pulse asks for one account's tracked
  // contacts. The partial index holds only those rows.
  // tenant-lint: allow boot migration
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_contacts_owner_tracked
     ON contacts(ownerId) WHERE isTracked = 1`,
  );
}

// =============================================================================
// 5. Auto-stamp updatedAt on every interactions mutation
// =============================================================================
// Same pattern as contacts — guarantees updatedAt is always current even when
// background processes (mention extraction, EML import re-parent, etc.) update rows.
// =============================================================================
function interactionsTriggers(sqlite: Database.Database): void {
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
    "updatedAt and score-dirty triggers installed (contacts, interactions, action_items)",
  );
}

// =============================================================================
// 6. Action Items Table + Sync Triggers
// =============================================================================
// Drizzle `0000` creates the action_items table. This section adds its two
// indexes. Three triggers keep contacts.nextFollowUpAt in sync as a
// denormalized cache set to MIN(dueAt) of pending (non-completed) action items.
// =============================================================================
function actionItems(sqlite: Database.Database): void {
  sqlite.exec(`
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
    -- A task that moved between contacts leaves the old one's cache behind.
    -- A merge re-parents tasks, and without this the duplicate kept showing
    -- a follow-up it no longer had. Same-contact updates match nothing here.
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = OLD.contactId AND completedAt IS NULL
    ) WHERE id = OLD.contactId AND OLD.contactId != NEW.contactId;
  END;

  DROP TRIGGER IF EXISTS action_items_sync_delete;
  CREATE TRIGGER action_items_sync_delete AFTER DELETE ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = OLD.contactId AND completedAt IS NULL
    ) WHERE id = OLD.contactId;
  END;
`);

  // A new contact starts dirty through the column default, so no INSERT trigger
  // is needed here. The three statements below cover the rows a contact does not
  // own: an interaction or an action item that is written, changed, or removed
  // changes what the score is computed from.
  //
  // Each is guarded by `scoreDirty = 0`, so importing a thousand interactions
  // against one already-dirty contact costs a thousand index seeks and one row
  // write rather than a thousand.
  //
  // Action items do not feed the formula today — it reads `cadenceDays`,
  // `lastContactedAt` and the interaction history and nothing else. They are
  // marked anyway because the story names them and because a formula that grows
  // to read them must not need a migration to be correct.
  // tenant-lint: allow boot migration
  sqlite.exec(`
  DROP TRIGGER IF EXISTS interactions_score_dirty_ins;
  CREATE TRIGGER interactions_score_dirty_ins AFTER INSERT ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = NEW.contactId AND scoreDirty = 0;
  END;

  DROP TRIGGER IF EXISTS interactions_score_dirty_upd;
  CREATE TRIGGER interactions_score_dirty_upd AFTER UPDATE ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id IN (NEW.contactId, OLD.contactId) AND scoreDirty = 0;
  END;

  DROP TRIGGER IF EXISTS interactions_score_dirty_del;
  CREATE TRIGGER interactions_score_dirty_del AFTER DELETE ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = OLD.contactId AND scoreDirty = 0;
  END;

  DROP TRIGGER IF EXISTS action_items_score_dirty_ins;
  CREATE TRIGGER action_items_score_dirty_ins AFTER INSERT ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = NEW.contactId AND scoreDirty = 0;
  END;

  DROP TRIGGER IF EXISTS action_items_score_dirty_upd;
  CREATE TRIGGER action_items_score_dirty_upd AFTER UPDATE ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id IN (NEW.contactId, OLD.contactId) AND scoreDirty = 0;
  END;

  DROP TRIGGER IF EXISTS action_items_score_dirty_del;
  CREATE TRIGGER action_items_score_dirty_del AFTER DELETE ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = OLD.contactId AND scoreDirty = 0;
  END;
`);

  log.info("Database", "action_items table + sync triggers installed");
}

// =============================================================================
// 9. Deduplication Engine Schema
// =============================================================================
// `canonicalId` and `phoneticHash` are added in §2z-0, and the suggestion,
// exclusion and merge-log tables are created in §2z-3. Only the phonetic
// index is made here.
// =============================================================================
function phoneticIndex(sqlite: Database.Database): void {
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS idx_contacts_phonetic ON contacts(phoneticHash)`,
  );
}

// 9g. Embedding metadata: tracks when each contact was last embedded
//     Used for staleness detection — if contact.updatedAt > embeddedAt, re-embed
function dedupeEmbeddingMeta(sqlite: Database.Database): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dedupe_embedding_meta (
    contactId TEXT PRIMARY KEY,
    embeddedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);
}

// Settings the app no longer reads (RETIRED_SETTING_KEYS in server/db/helpers.ts).
function retiredSettings(sqlite: Database.Database): void {
  const removedSettings = deleteRetiredSettings(sqlite);
  if (removedSettings > 0) {
    log.info(
      "Database",
      `Removed ${removedSettings} retired setting(s) from app_settings`,
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
function hotPathIndexes(sqlite: Database.Database): void {
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
}

// 11. Mention Rows Backfill (backfillMentionRows in server/db/helpers.ts).
function mentionRows(sqlite: Database.Database): void {
  const mentionRowsAdded = backfillMentionRows(sqlite);
  if (mentionRowsAdded > 0) {
    log.info(
      "Database",
      `Backfilled ${mentionRowsAdded} mention rows from notes read by AI`,
    );
  }
}

// The geocode cache, moved from server/services/geocoding/cache.ts, which
// created it when the module was imported.
function geocodeCache(sqlite: Database.Database): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS geocode_cache (
    key       TEXT PRIMARY KEY,
    lat       REAL,
    lng       REAL,
    provider  TEXT NOT NULL,
    success   INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);
}
