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
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/db/schema.ts";
import { log } from "./utils/logger.ts";
import crypto from "crypto";

// =============================================================================
// 1. Open SQLite Connection
// =============================================================================

import path from "path";
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
// 2a. Data Cleanup — Sanitize legacy AI Search artifacts
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
} catch (err: any) {
  log.warn("Database", `Data cleanup skipped: ${err.message}`);
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

try {
  sqlite.exec(`DROP TABLE IF EXISTS contacts_fts`);
} catch {
  /* may not exist */
}

sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
    contactId UNINDEXED, name, company, role, headline, location, about, industry, extras, searchExpansion
  );

  DROP TRIGGER IF EXISTS contacts_ai;
  CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    VALUES (
      new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = new.id), ''),
      COALESCE(new.searchExpansion, '')
    );
  END;

  DROP TRIGGER IF EXISTS contacts_ad;
  CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
  END;

  DROP TRIGGER IF EXISTS contacts_au;
  CREATE TRIGGER contacts_au AFTER UPDATE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    VALUES (
      new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = new.id), ''),
      COALESCE(new.searchExpansion, '')
    );
  END;

  -- Child-table triggers: refresh FTS when tags, interests, emails, or phones change
  DROP TRIGGER IF EXISTS fts_tags_ai;
  CREATE TRIGGER fts_tags_ai AFTER INSERT ON contact_tags BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_tags_ad;
  CREATE TRIGGER fts_tags_ad AFTER DELETE ON contact_tags BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_interests_ai;
  CREATE TRIGGER fts_interests_ai AFTER INSERT ON contact_interests BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_interests_ad;
  CREATE TRIGGER fts_interests_ad AFTER DELETE ON contact_interests BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_emails_ai;
  CREATE TRIGGER fts_emails_ai AFTER INSERT ON contact_emails BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_emails_ad;
  CREATE TRIGGER fts_emails_ad AFTER DELETE ON contact_emails BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  -- Phone number triggers: refresh FTS when phones are added or removed
  DROP TRIGGER IF EXISTS fts_phones_ai;
  CREATE TRIGGER fts_phones_ai AFTER INSERT ON contact_phones BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_phones_ad;
  CREATE TRIGGER fts_phones_ad AFTER DELETE ON contact_phones BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
      COALESCE(c.searchExpansion, '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  -- Backfill FTS for any contacts not yet indexed (including phones in extras)
  INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
  SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
    COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
    COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
    COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), ''),
    COALESCE(c.searchExpansion, '')
  FROM contacts c
  WHERE c.id NOT IN (SELECT contactId FROM contacts_fts);
`);

log.info("Database", "FTS5 search index ready");

// =============================================================================
// 4. Auto-stamp updatedAt on every contacts mutation
// =============================================================================
// Guarantees updatedAt is always current regardless of which code path
// (geocoder, archive toggle, bulk update, etc.) mutates the row.
// Uses AFTER UPDATE to avoid recursion — the trigger itself runs after
// the original UPDATE, and the SET updatedAt is a no-op if already current.
// =============================================================================

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
    `
  SELECT id, nextFollowUpAt FROM contacts
  WHERE nextFollowUpAt IS NOT NULL
    AND id NOT IN (SELECT DISTINCT contactId FROM action_items WHERE completedAt IS NULL)
`,
  )
  .all() as { id: string; nextFollowUpAt: string }[];

if (orphanedFollowUps.length > 0) {
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
    embedding FLOAT[768]
  );
`);

log.info("Database", "contact_embeddings vec0 table ready (768-dim)");

// 9f-b. Search embedding vector storage (local model, 384-dim)
// Separate from dedupe embeddings — optimized for search with local model
sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_embeddings USING vec0(
    contactId TEXT PRIMARY KEY,
    embedding FLOAT[384]
  );
`);

log.info(
  "Database",
  "search_embeddings vec0 table ready (384-dim, local model)",
);

// 9g. Embedding metadata: tracks when each contact was last embedded
//     Used for staleness detection — if contact.updatedAt > embeddedAt, re-embed
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS dedupe_embedding_meta (
    contactId TEXT PRIMARY KEY,
    embeddedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);

// =============================================================================
// 10. Phonetic Hash Backfill
// =============================================================================
// One-time idempotent backfill: compute Double Metaphone for all contacts
// that don't yet have a phoneticHash. On subsequent runs this is a no-op.
// =============================================================================

import { doubleMetaphone } from "./utils/nlp/index.ts";

const contactsMissingHash = sqlite
  .prepare(
    `
  SELECT id, name FROM contacts WHERE phoneticHash IS NULL AND name IS NOT NULL
`,
  )
  .all() as { id: string; name: string }[];

if (contactsMissingHash.length > 0) {
  const updateStmt = sqlite.prepare(
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
