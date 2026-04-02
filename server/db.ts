import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/db/schema.ts";
import crypto from "crypto";
import { log } from "./logger.ts";

const DB_PATH = "curator.db";
export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

log.info("Database", `Opened ${DB_PATH} (WAL mode, foreign keys ON)`);

sqlite.exec(`
  -- Core contacts table (all scalar fields)
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    firstName TEXT,
    lastName TEXT,
    headline TEXT,
    role TEXT,
    company TEXT,
    location TEXT,
    birthday TEXT,
    preferences TEXT,
    avatarUrl TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    updatedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    cadenceDays INTEGER DEFAULT 90,
    lastContactedAt TEXT,
    nextFollowUpAt TEXT,
    themeColor TEXT DEFAULT 'brand',
    about TEXT,
    pronouns TEXT,
    industry TEXT,
    website TEXT,
    lat REAL,
    lng REAL,
    aiBriefing TEXT,
    aiBriefingAt TEXT,
    isGhost INTEGER DEFAULT 0
  );

  -- Normalized child tables
  CREATE TABLE IF NOT EXISTS contact_emails (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    label TEXT DEFAULT 'personal',
    isPrimary INTEGER DEFAULT 0,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_phones (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    label TEXT DEFAULT 'mobile',
    isPrimary INTEGER DEFAULT 0,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_social_links (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    handle TEXT,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_education (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    school TEXT NOT NULL,
    degree TEXT,
    fieldOfStudy TEXT,
    startDate TEXT,
    endDate TEXT,
    description TEXT,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_experience (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company TEXT NOT NULL,
    role TEXT,
    startDate TEXT,
    endDate TEXT,
    isCurrent INTEGER DEFAULT 0,
    description TEXT,
    location TEXT,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_sources (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    externalId TEXT,
    connectedOn TEXT,
    importedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    rawData TEXT
  );

  CREATE TABLE IF NOT EXISTS contact_tags (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_addresses (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    label TEXT DEFAULT 'home',
    isPrimary INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  -- Interactions / timeline
  CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    date TEXT DEFAULT (CURRENT_TIMESTAMP),
    duration TEXT,
    fileUrl TEXT,
    fileName TEXT,
    fileType TEXT,
    source TEXT,
    mentions TEXT
  );

  CREATE TABLE IF NOT EXISTS interaction_mentions (
    interactionId TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (interactionId, contactId)
  );

  -- Lists (user-created contact groups)
  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'star',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS list_members (
    listId TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (listId, contactId)
  );
`);

log.info("Database", "All tables verified");

// Migration: isPremium → Starred list
try {
  const colCheck = sqlite.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
  if (colCheck.some(c => c.name === 'isPremium')) {
    const starredRow = sqlite.prepare("SELECT id FROM lists WHERE name = 'Starred'").get() as { id: string } | undefined;
    let starredId = starredRow?.id;
    if (!starredId) {
      starredId = crypto.randomUUID();
      sqlite.prepare("INSERT INTO lists (id, name, icon, sortOrder) VALUES (?, 'Starred', 'star', 0)").run(starredId);
      log.info("Migration", `Created default 'Starred' list (${starredId})`);
    }

    const premiums = sqlite.prepare("SELECT id FROM contacts WHERE isPremium = 1").all() as { id: string }[];
    if (premiums.length > 0) {
      const insertMember = sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)");
      for (const p of premiums) {
        insertMember.run(starredId, p.id);
      }
      log.info("Migration", `Migrated ${premiums.length} premium contact(s) into 'Starred' list`);
    }

    try {
      sqlite.exec("ALTER TABLE contacts DROP COLUMN isPremium");
      log.info("Migration", "Dropped isPremium column from contacts table");
    } catch (dropErr: any) {
      log.warn("Migration", `Could not drop isPremium column: ${dropErr.message}`);
    }
  }
} catch (migErr: any) {
  log.warn("Migration", `isPremium migration check skipped: ${migErr.message}`);
}

// FTS5 Virtual Table
try { sqlite.exec(`DROP TABLE IF EXISTS contacts_fts`); } catch { /* may not exist */ }

sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
    contactId UNINDEXED, name, company, role, headline, location, about, industry
  );

  DROP TRIGGER IF EXISTS contacts_ai;
  CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry)
    VALUES (new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry);
  END;

  DROP TRIGGER IF EXISTS contacts_ad;
  CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
  END;

  DROP TRIGGER IF EXISTS contacts_au;
  CREATE TRIGGER contacts_au AFTER UPDATE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry)
    VALUES (new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry);
  END;

  -- Backfill FTS for any contacts not yet indexed
  INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry)
  SELECT id, name, company, role, headline, location, about, industry FROM contacts
  WHERE id NOT IN (SELECT contactId FROM contacts_fts);
`);

log.info("Database", "FTS5 search index ready");

export const db = drizzle(sqlite, { schema });
