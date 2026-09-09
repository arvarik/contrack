// =============================================================================
// A 1.5.5-shaped database, built from the released schema
// =============================================================================
// This is the only place that knows what Contrack looked like before the
// tenancy work. The SQL below is copied verbatim from `server/db.ts` at the
// `v1.5.5` tag: the ten-column `contacts_fts` with no `ownerTok`, the eleven
// FTS triggers that delete by `contactId`, the three `_auto_updated_at`
// triggers, the three `action_items_sync_*` triggers, the two `vec0` tables
// with no partition key, and `ownerId` on four tables instead of eight.
//
// It exists so `tenancy.migration.test.ts` can prove the upgrade on the shape
// real installations actually have, rather than on a database this branch
// built. Do not "modernise" anything here. If it drifts from the release, the
// migration test stops testing the migration.
//
// Regenerate the SQL constants with:
//   git show v1.5.5:server/db.ts
// =============================================================================

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/** contacts_fts, its eleven triggers, and the bulk backfill, at v1.5.5. */
const FTS_V1 = `
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
    -- Trash-aware: soft-deleted contacts are removed from the index and
    -- not reinserted until restored (deletedAt cleared).
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry, extras, searchExpansion)
    SELECT
      new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry,
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = new.id), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(phone, ' ') FROM contact_phones WHERE contactId = new.id), ''),
      COALESCE(new.searchExpansion, '')
    WHERE new.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = new.contactId AND c.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = old.contactId AND c.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = new.contactId AND c.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = old.contactId AND c.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = new.contactId AND c.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = old.contactId AND c.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = new.contactId AND c.deletedAt IS NULL;
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
    FROM contacts c WHERE c.id = old.contactId AND c.deletedAt IS NULL;
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
  WHERE c.id NOT IN (SELECT contactId FROM contacts_fts)
    AND c.deletedAt IS NULL;
`;

/** The three updatedAt auto-stamp triggers, at v1.5.5. */
const UPDATED_AT_V1 = `
  DROP TRIGGER IF EXISTS contacts_auto_updated_at;
  CREATE TRIGGER contacts_auto_updated_at AFTER UPDATE ON contacts
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE contacts SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;
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
`;

/** The three action_items sync triggers, at v1.5.5. */
const SYNC_V1 = `
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
`;

/** Every trigger a 1.5.5 database has. The migration must give all of them back. */
export const V1_TRIGGERS = [
  "contacts_ai",
  "contacts_au",
  "contacts_ad",
  "fts_tags_ai",
  "fts_tags_ad",
  "fts_interests_ai",
  "fts_interests_ad",
  "fts_emails_ai",
  "fts_emails_ad",
  "fts_phones_ai",
  "fts_phones_ad",
  "contacts_auto_updated_at",
  "interactions_auto_updated_at",
  "action_items_auto_updated_at",
  "action_items_sync_insert",
  "action_items_sync_update",
  "action_items_sync_delete",
];

/** What 1.5.5 called OWNED_TABLES. Four, against Phase 1's eight. */
const V1_OWNED_TABLES = [
  "contacts",
  "lists",
  "ai_invocations",
  "dedupe_merge_log",
];

export interface V1Fixture {
  /** DATA_DIR to hand the app under test. */
  dataDir: string;
  dbPath: string;
  contactIds: string[];
  /** The contact §8 will build an action item for on the next boot. */
  legacyFollowUpId: string;
  /** contactId to updatedAt, read after seeding. The migration must not move these. */
  contactUpdatedAt: Record<string, string>;
  interactionUpdatedAt: Record<string, string>;
  /** A fixed query vector and the nearest neighbour it found before the rebuild. */
  queryVector: Buffer;
  nearestSearch: string;
  nearestDedupe: string;
  vectorCounts: { search: number; dedupe: number };
  /** Files on disk, and the URLs the rows point at. */
  avatarUrls: { id: string; url: string; file: string }[];
  attachmentUrls: { id: string; url: string; file: string }[];
  orphanFile: string;
  /** The real account, when built with one. */
  account: { id: string; username: string } | null;
}

function runDrizzleMigrations(db: Database.Database): void {
  const dir = path.resolve("drizzle");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  // Drizzle's own journal, so `migrate()` on the next boot treats these as
  // applied instead of replaying them onto tables that already exist.
  db.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const journal = JSON.parse(
    fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const insert = db.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(dir, `${entry.tag}.sql`), "utf8");
    insert.run(
      crypto.createHash("sha256").update(sql).digest("hex"),
      entry.when,
    );
  }
}

/** A deterministic unit vector, so the KNN assertion is reproducible. */
function vector(seed: number, dimension: number): Buffer {
  const v = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) {
    v[i] = Math.sin((seed + 1) * (i + 1) * 0.017);
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dimension; i++) v[i] /= norm;
  return Buffer.from(v.buffer);
}

/**
 * Build a database that looks exactly like a used 1.5.5 install.
 *
 * @param options.withAccount create a real signed-up account, so the
 *   auth-on upgrade path can be tested. Without it every row is unowned,
 *   which is the auth-off path and what most installations look like.
 */
export function makeV1Database(
  options: { withAccount?: boolean } = {},
): V1Fixture {
  const dataDir = mkdtempSync(path.join(tmpdir(), "contrack-v1-"));
  const dbPath = path.join(dataDir, "curator.db");
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runDrizzleMigrations(db);

  // §2z at v1.5.5: users and sessions, with none of the Phase 1 columns.
  db.exec(`
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

  // Contacts columns 1.5.5 adds outside Drizzle.
  for (const column of [
    "searchExpansion TEXT",
    "deletedAt TEXT",
    "canonicalId TEXT",
    "phoneticHash TEXT",
  ]) {
    db.exec(`ALTER TABLE contacts ADD COLUMN ${column}`);
  }

  // §9c to §9e, §9g, §9g2 at v1.5.5.
  db.exec(`
    CREATE TABLE IF NOT EXISTS dedupe_suggestions (
      id TEXT PRIMARY KEY,
      contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      matchType TEXT NOT NULL, confidence REAL NOT NULL, reasoning TEXT NOT NULL,
      matchedField TEXT, status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT DEFAULT (CURRENT_TIMESTAMP), reviewedAt TEXT, reviewedBy TEXT,
      UNIQUE(contactIdA, contactIdB)
    );
    CREATE TABLE IF NOT EXISTS dedupe_exclusions (
      contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      createdAt TEXT DEFAULT (CURRENT_TIMESTAMP),
      PRIMARY KEY (contactIdA, contactIdB)
    );
    CREATE TABLE IF NOT EXISTS dedupe_merge_log (
      id TEXT PRIMARY KEY, primaryId TEXT NOT NULL, duplicateId TEXT NOT NULL,
      mergedBy TEXT NOT NULL, mergeType TEXT NOT NULL, confidence REAL NOT NULL,
      reasoning TEXT NOT NULL, mergedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
      undoneAt TEXT, duplicateSnapshot TEXT
    );
    CREATE TABLE IF NOT EXISTS dedupe_embedding_meta (
      contactId TEXT PRIMARY KEY,
      embeddedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY, lat REAL, lng REAL,
      cachedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
  `);

  // The embeddings signature the app will read back. Without a matching row
  // ensureEmbeddingStore decides the model changed and re-embeds the corpus
  // through the paid provider, which is the exact thing the migration
  // promises not to do.
  const state = JSON.stringify({
    signature: "builtin/Xenova/all-MiniLM-L6-v2",
    dimension: 384,
  });
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('ai.embeddingsState', ?)",
  ).run(state);
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('ai.embeddingsState.dedupe', ?)",
  ).run(
    JSON.stringify({
      signature: "builtin/Xenova/all-MiniLM-L6-v2",
      dimension: 768,
    }),
  );

  // §9f and §9f-b at v1.5.5: no partition key.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS contact_embeddings USING vec0(
      contactId TEXT PRIMARY KEY, embedding FLOAT[768]);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_embeddings USING vec0(
      contactId TEXT PRIMARY KEY, embedding FLOAT[384]);
  `);

  // §9i at v1.5.5: ownerId on four tables, every row NULL.
  for (const table of V1_OWNED_TABLES) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_${table}_owner ON ${table}(ownerId)`,
    );
  }

  db.exec(FTS_V1);
  db.exec(UPDATED_AT_V1);
  db.exec(SYNC_V1);
  db.pragma("user_version = 1");

  // ---------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------
  const account = options.withAccount
    ? { id: crypto.randomUUID(), username: "realowner" }
    : null;
  if (account) {
    db.prepare(
      `INSERT INTO users (id, email, username, displayName, passwordHash, role)
       VALUES (?, 'real@example.com', ?, 'Real Owner', 'scrypt$65536$8$1$c2FsdA==$aGFzaA==', 'admin')`,
    ).run(account.id, account.username);
  }

  const contactIds: string[] = [];
  const insertContact = db.prepare(
    `INSERT INTO contacts (id, name, company, role, location, about, industry, addedAt, updatedAt, ownerId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEmail = db.prepare(
    "INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, ?, 0)",
  );
  db.transaction(() => {
    for (let i = 0; i < 50; i++) {
      const id = `v1-contact-${String(i).padStart(3, "0")}`;
      // Distinct, deliberately old timestamps. The migration must leave every
      // one byte-identical: findStaleEmbeddings compares updatedAt against
      // embeddedAt, so a stamped corpus is a re-embedded corpus.
      const stamp = `2024-0${(i % 9) + 1}-1${i % 10} 0${i % 10}:0${i % 6}:0${i % 6}`;
      insertContact.run(
        id,
        `Person ${i}`,
        `Company ${i % 7}`,
        i % 2 ? "Engineer" : "Designer",
        ["Austin", "Berlin", "Lagos"][i % 3],
        `Notes about person ${i}`,
        "Software",
        stamp,
        stamp,
        account ? account.id : null,
      );
      insertEmail.run(`v1-email-${i}`, id, `person${i}@example.com`);
      contactIds.push(id);
    }
  })();

  // Filled at the end, once every write that fires interactions_auto_updated_at
  // has happened, so the baseline is the state the migration starts from.
  const interactionUpdatedAt: Record<string, string> = {};
  db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO interactions (id, contactId, type, title, date, content, updatedAt)
       VALUES (?, ?, 'note', ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 20; i++) {
      const stamp = `2024-05-0${(i % 9) + 1} 1${i % 10}:00:00`;
      insert.run(
        `v1-interaction-${i}`,
        contactIds[i],
        `Touchpoint ${i}`,
        stamp,
        `Discussed the roadmap, round ${i}.`,
        stamp,
      );
    }
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO action_items (id, contactId, title, dueAt) VALUES (?, ?, ?, '2027-01-01')`,
      ).run(`v1-action-${i}`, contactIds[i], `Follow up ${i}`);
    }
    // A contact with a follow-up date and no action item. §8 of server/db.ts
    // creates one for it on the next boot, which is the only code path that
    // inserts into an owned table after the invariant triggers are armed. It
    // is here so the fill trigger gets exercised for real rather than only in
    // isolation. Its own updatedAt moves, because action_items_sync_insert
    // writes back to the contact; that is 1.5.5 behaviour, not the migration's.
    db.prepare(
      "UPDATE contacts SET nextFollowUpAt = '2027-06-01' WHERE id = ?",
    ).run(contactIds[49]);
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO lists (id, name, ownerId) VALUES (?, ?, ?)`).run(
        `v1-list-${i}`,
        `List ${i}`,
        account ? account.id : null,
      );
    }
    for (let i = 0; i < 2; i++) {
      db.prepare(
        `INSERT INTO dedupe_suggestions (id, contactIdA, contactIdB, matchType, confidence, reasoning)
         VALUES (?, ?, ?, 'name', 0.9, 'looks the same')`,
      ).run(`v1-sugg-${i}`, contactIds[i], contactIds[i + 25]);
    }
    db.prepare(
      `INSERT INTO dedupe_exclusions (contactIdA, contactIdB) VALUES (?, ?)`,
    ).run(contactIds[3], contactIds[30]);
    db.prepare(
      `INSERT INTO dedupe_merge_log (id, primaryId, duplicateId, mergedBy, mergeType, confidence, reasoning, ownerId)
       VALUES ('v1-merge-0', ?, ?, 'test', 'manual', 1.0, 'merged', ?)`,
    ).run(contactIds[4], contactIds[40], account ? account.id : null);
    db.prepare(
      `INSERT INTO ai_invocations (id, operation, model, tokenCount, latencyMs, cached, ownerId)
       VALUES ('v1-inv-0', 'rerank', 'mock', 10, 5, 0, ?)`,
    ).run(account ? account.id : null);
  })();

  // Vectors: ten in each store, no partition key, plus the meta rows that
  // stop the dedupe scan treating them as stale.
  const queryVector = vector(3, 384);
  db.transaction(() => {
    const search = db.prepare(
      "INSERT INTO search_embeddings (contactId, embedding) VALUES (?, ?)",
    );
    const dedupe = db.prepare(
      "INSERT INTO contact_embeddings (contactId, embedding) VALUES (?, ?)",
    );
    const meta = db.prepare(
      "INSERT INTO dedupe_embedding_meta (contactId, embeddedAt) VALUES (?, '2030-01-01 00:00:00')",
    );
    for (let i = 0; i < 10; i++) {
      search.run(contactIds[i], vector(i, 384));
      dedupe.run(contactIds[i], vector(i, 768));
      meta.run(contactIds[i]);
    }
  })();

  const nearestSearch = (
    db
      .prepare(
        "SELECT contactId FROM search_embeddings WHERE embedding MATCH ? AND k = 1",
      )
      .get(queryVector) as { contactId: string }
  ).contactId;
  const nearestDedupe = (
    db
      .prepare(
        "SELECT contactId FROM contact_embeddings WHERE embedding MATCH ? AND k = 1",
      )
      .get(vector(3, 768)) as { contactId: string }
  ).contactId;

  // ---------------------------------------------------------------------
  // Uploads, in the flat 1.x layout
  // ---------------------------------------------------------------------
  const uploads = path.join(dataDir, "uploads");
  const avatarsDir = path.join(uploads, "avatars");
  fs.mkdirSync(avatarsDir, { recursive: true });

  const avatarUrls: { id: string; url: string; file: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const file = `avatar-old-${i}.jpg`;
    fs.writeFileSync(path.join(avatarsDir, file), `avatar bytes ${i}`);
    const url = `/uploads/avatars/${file}`;
    db.prepare("UPDATE contacts SET avatarUrl = ? WHERE id = ?").run(
      url,
      contactIds[i],
    );
    avatarUrls.push({ id: contactIds[i], url, file });
  }
  // Left alone by the relocation: a generated avatar and an external one.
  db.prepare("UPDATE contacts SET avatarUrl = ? WHERE id = ?").run(
    "/api/avatar/avataaars?seed=x",
    contactIds[10],
  );
  db.prepare("UPDATE contacts SET avatarUrl = ? WHERE id = ?").run(
    "https://example.com/face.png",
    contactIds[11],
  );

  const attachmentUrls: { id: string; url: string; file: string }[] = [];
  for (let i = 0; i < 2; i++) {
    const file = `file-old-${i}.pdf`;
    fs.writeFileSync(path.join(uploads, file), `attachment bytes ${i}`);
    const url = `/uploads/${file}`;
    db.prepare(
      "UPDATE interactions SET fileUrl = ?, fileName = ? WHERE id = ?",
    ).run(url, file, `v1-interaction-${i}`);
    attachmentUrls.push({ id: `v1-interaction-${i}`, url, file });
  }

  // A file no row points at. The relocation must move it aside, not delete it.
  const orphanFile = "orphan-nobody-wants.jpg";
  fs.writeFileSync(path.join(avatarsDir, orphanFile), "orphan bytes");

  // A shared logo, which must stay exactly where it is.
  fs.mkdirSync(path.join(uploads, "logos"), { recursive: true });
  fs.writeFileSync(path.join(uploads, "logos", "acme.png"), "logo bytes");

  // A database that has actually run 1.5.5 has phoneticHash filled: §10 of
  // server/db.ts backfills it on the first boot after §9b adds the column.
  // Leaving it NULL here would make that backfill run again during the
  // upgrade, and since §10 sits after §4 recreates contacts_auto_updated_at,
  // it would stamp every row. That is 1.5.5 behaviour on a 1.4-era database,
  // not something the tenancy migration does, and reproducing it here would
  // hide the thing this fixture exists to measure.
  db.prepare(
    "UPDATE contacts SET phoneticHash = 'PRSN' WHERE phoneticHash IS NULL",
  ).run();

  // Those writes fired contacts_au and contacts_auto_updated_at. Read the
  // timestamps back afterwards so the "unchanged by the migration" assertion
  // compares against the real starting state.
  const contactUpdatedAt: Record<string, string> = {};
  for (const row of db.prepare("SELECT id, updatedAt FROM contacts").all() as {
    id: string;
    updatedAt: string;
  }[]) {
    contactUpdatedAt[row.id] = row.updatedAt;
  }
  for (const row of db
    .prepare("SELECT id, updatedAt FROM interactions")
    .all() as { id: string; updatedAt: string }[]) {
    interactionUpdatedAt[row.id] = row.updatedAt;
  }

  const vectorCounts = {
    search: (
      db.prepare("SELECT COUNT(*) AS n FROM search_embeddings").get() as {
        n: number;
      }
    ).n,
    dedupe: (
      db.prepare("SELECT COUNT(*) AS n FROM contact_embeddings").get() as {
        n: number;
      }
    ).n,
  };

  db.close();

  return {
    dataDir,
    dbPath,
    contactIds,
    legacyFollowUpId: contactIds[49],
    contactUpdatedAt,
    interactionUpdatedAt,
    queryVector,
    nearestSearch,
    nearestDedupe,
    vectorCounts,
    avatarUrls,
    attachmentUrls,
    orphanFile,
    account,
  };
}
