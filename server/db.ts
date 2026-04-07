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

const DB_PATH = "curator.db";
export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

log.info("Database", `Opened ${DB_PATH} (WAL mode, foreign keys ON)`);

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
// 3. FTS5 Full-Text Search Index
// =============================================================================
// FTS5 virtual tables are NOT managed by Drizzle ORM, so we maintain them
// here with explicit DDL. The index is rebuilt on every startup to ensure
// consistency with the current data.
// =============================================================================

try { sqlite.exec(`DROP TABLE IF EXISTS contacts_fts`); } catch { /* may not exist */ }

sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
    contactId UNINDEXED, name, company, role, headline, location, about, industry, extras
  );

  DROP TRIGGER IF EXISTS contacts_ai;
  CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    VALUES (
      new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = new.id), '')
    );
  END;

  DROP TRIGGER IF EXISTS contacts_ad;
  CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
  END;

  DROP TRIGGER IF EXISTS contacts_au;
  CREATE TRIGGER contacts_au AFTER UPDATE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    VALUES (
      new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = new.id), '')
    );
  END;

  -- Child-table triggers: refresh FTS when tags, interests, emails, or phones change
  DROP TRIGGER IF EXISTS fts_tags_ai;
  CREATE TRIGGER fts_tags_ai AFTER INSERT ON contact_tags BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_tags_ad;
  CREATE TRIGGER fts_tags_ad AFTER DELETE ON contact_tags BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_interests_ai;
  CREATE TRIGGER fts_interests_ai AFTER INSERT ON contact_interests BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_interests_ad;
  CREATE TRIGGER fts_interests_ad AFTER DELETE ON contact_interests BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_emails_ai;
  CREATE TRIGGER fts_emails_ai AFTER INSERT ON contact_emails BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_emails_ad;
  CREATE TRIGGER fts_emails_ad AFTER DELETE ON contact_emails BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  -- Phone number triggers: refresh FTS when phones are added or removed
  DROP TRIGGER IF EXISTS fts_phones_ai;
  CREATE TRIGGER fts_phones_ai AFTER INSERT ON contact_phones BEGIN
    DELETE FROM contacts_fts WHERE contactId = new.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = new.contactId;
  END;

  DROP TRIGGER IF EXISTS fts_phones_ad;
  CREATE TRIGGER fts_phones_ad AFTER DELETE ON contact_phones BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.contactId;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
    SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
    FROM contacts c WHERE c.id = old.contactId;
  END;

  -- Backfill FTS for any contacts not yet indexed (including phones in extras)
  INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras)
  SELECT c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
    COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), '') || ' ' ||
    COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
    COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = c.id), '')
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

log.info("Database", "updatedAt triggers installed (contacts, interactions, action_items)");

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
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN relationshipScore INTEGER DEFAULT 50`);
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

const orphanedFollowUps = sqlite.prepare(`
  SELECT id, nextFollowUpAt FROM contacts
  WHERE nextFollowUpAt IS NOT NULL
    AND id NOT IN (SELECT DISTINCT contactId FROM action_items WHERE completedAt IS NULL)
`).all() as { id: string; nextFollowUpAt: string }[];

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
  log.info("Database", `Backfilled ${orphanedFollowUps.length} action_items from legacy nextFollowUpAt`);
}
