// =============================================================================
// Migration 0001_baseline
// =============================================================================
// The schema of a new Contrack 2 database: its tables, then their indexes,
// then their triggers, and the local owner, the account that owns this
// device's data while nobody has signed in (server/db/owners.ts).
//
// Each statement is the text SQLite stores for the object, as a new database
// at d67c8a9 held it. tests/integration/db.migrations.test.ts compares a new
// database with tests/fixtures/schema/v2.0-d67c8a9.sql byte for byte, so do
// not reformat them.
//
// Not here: the derived structures (the FTS tables, the vec0 stores, the
// passage index and the search vector triggers). Their installers run on
// every boot, after the migrations (server/db/indexes.ts).
//
// Never edit this file. A change to the schema is a new migration
// (`npm run db:new <name>`).
// =============================================================================

import type Database from "better-sqlite3";
import { ensureLocalOwner } from "../owners.ts";

export function up(db: Database.Database): void {
  db.exec(TABLES);
  db.exec(INDEXES);
  db.exec(TRIGGERS);
  ensureLocalOwner(db);
}

/** Every table, in the order a new database created them. */
const TABLES = `
CREATE TABLE \`action_items\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`interactionId\` text,
	\`title\` text NOT NULL,
	\`dueAt\` text NOT NULL,
	\`completedAt\` text,
	\`createdAt\` text DEFAULT (CURRENT_TIMESTAMP),
	\`updatedAt\` text DEFAULT (CURRENT_TIMESTAMP), ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`interactionId\`) REFERENCES \`interactions\`(\`id\`) ON UPDATE no action ON DELETE set null
);

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

CREATE TABLE \`contact_attributes\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`name\` text NOT NULL,
	\`value\` text NOT NULL,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE \`contact_interests\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`interest\` text NOT NULL,
	\`isAiGenerated\` integer DEFAULT false,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE \`contact_tags\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`contactId\` text NOT NULL,
	\`tag\` text NOT NULL,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

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
, searchExpansion TEXT, deletedAt TEXT, canonicalId TEXT, phoneticHash TEXT, geoSource TEXT, isTracked INTEGER NOT NULL DEFAULT 0, trackedAt TEXT, aiResearch TEXT, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT, scoreDirty INTEGER NOT NULL DEFAULT 1);

CREATE TABLE \`interaction_mentions\` (
	\`interactionId\` text NOT NULL,
	\`contactId\` text NOT NULL,
	PRIMARY KEY(\`interactionId\`, \`contactId\`),
	FOREIGN KEY (\`interactionId\`) REFERENCES \`interactions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

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
	\`updatedAt\` text DEFAULT (CURRENT_TIMESTAMP), ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE \`list_members\` (
	\`listId\` text NOT NULL,
	\`contactId\` text NOT NULL,
	\`addedAt\` text DEFAULT (CURRENT_TIMESTAMP),
	PRIMARY KEY(\`listId\`, \`contactId\`),
	FOREIGN KEY (\`listId\`) REFERENCES \`lists\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE \`lists\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`icon\` text DEFAULT 'star' NOT NULL,
	\`sortOrder\` integer DEFAULT 0 NOT NULL,
	\`createdAt\` text DEFAULT (CURRENT_TIMESTAMP)
, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT);

CREATE TABLE \`ai_invocations\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`operation\` text NOT NULL,
	\`model\` text,
	\`tokenCount\` integer,
	\`latencyMs\` integer NOT NULL,
	\`cached\` integer DEFAULT 0 NOT NULL,
	\`description\` text,
	\`createdAt\` text DEFAULT (datetime('now')) NOT NULL
, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT);

CREATE TABLE \`search_passage_state\` (
	\`contactId\` text PRIMARY KEY NOT NULL,
	\`ownerId\` text NOT NULL,
	\`representationVersion\` integer NOT NULL,
	\`fingerprint\` text NOT NULL,
	\`signature\` text NOT NULL,
	\`indexedAt\` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (\`contactId\`) REFERENCES \`contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE users (
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
  , status TEXT NOT NULL DEFAULT 'active', credentialState TEXT NOT NULL DEFAULT 'password', mustChangePassword INTEGER NOT NULL DEFAULT 0, passwordChangedAt TEXT, disabledAt TEXT, createdBy TEXT REFERENCES users(id) ON DELETE SET NULL);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    userAgent TEXT,
    method TEXT
  );

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

CREATE TABLE api_tokens (
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

CREATE TABLE invitations (
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

CREATE TABLE user_settings (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (userId, key)
  );

CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    actorUserId TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    targetType TEXT,
    targetId TEXT,
    details TEXT,
    ip TEXT,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

CREATE TABLE passkeys (
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

CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    userId TEXT REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL
  );

CREATE TABLE auth_links (
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

CREATE TABLE dedupe_suggestions (
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
    reviewedBy TEXT, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
    UNIQUE(contactIdA, contactIdB)
  );

CREATE TABLE dedupe_exclusions (
    contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP), ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
    PRIMARY KEY (contactIdA, contactIdB)
  );

CREATE TABLE dedupe_merge_log (
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
  , ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT);

CREATE TABLE imports (
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

CREATE TABLE import_rows (
    importId TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    rowIndex INTEGER NOT NULL,
    status TEXT NOT NULL,
    contactId TEXT,
    name TEXT,
    error TEXT,
    payload TEXT,
    PRIMARY KEY (importId, rowIndex)
  );

CREATE TABLE score_snapshots (
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    weekStart TEXT NOT NULL,
    score REAL NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (contactId, weekStart)
  );

CREATE TABLE search_history (
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

CREATE TABLE connectors (
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

CREATE TABLE connector_runs (
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

CREATE TABLE connector_links (
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

CREATE TABLE upcoming_events (
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

CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    codeVerifier TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

CREATE TABLE map_views (
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

CREATE TABLE dedupe_embedding_meta (
    contactId TEXT PRIMARY KEY,
    embeddedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

CREATE TABLE geocode_cache (
    key       TEXT PRIMARY KEY,
    lat       REAL,
    lng       REAL,
    provider  TEXT NOT NULL,
    success   INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`;

/** Every index that is not a table's own key. */
const INDEXES = `
CREATE UNIQUE INDEX \`contact_addresses_contactId_address_unique\` ON \`contact_addresses\` (\`contactId\`,\`address\`);

CREATE UNIQUE INDEX \`contact_attributes_contactId_name_unique\` ON \`contact_attributes\` (\`contactId\`,\`name\`);

CREATE UNIQUE INDEX \`contact_interests_contactId_interest_unique\` ON \`contact_interests\` (\`contactId\`,\`interest\`);

CREATE INDEX \`idx_ai_invocations_created\` ON \`ai_invocations\` (\`createdAt\` DESC);

CREATE INDEX \`idx_search_passage_state_owner\` ON \`search_passage_state\` (\`ownerId\`);

CREATE INDEX \`idx_search_passages_contact\` ON \`search_passages\` (\`contactId\`);

CREATE INDEX \`idx_search_passages_owner\` ON \`search_passages\` (\`ownerId\`);

CREATE INDEX idx_sessions_user ON sessions(userId);

CREATE INDEX idx_sessions_expires ON sessions(expiresAt);

CREATE INDEX idx_api_tokens_user ON api_tokens(userId);

CREATE INDEX idx_audit_created ON audit_log(createdAt DESC);

CREATE INDEX idx_audit_actor ON audit_log(actorUserId, createdAt DESC);

CREATE INDEX idx_passkeys_user ON passkeys(userId);

CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expiresAt);

CREATE INDEX idx_auth_links_user ON auth_links(userId, createdAt);

CREATE INDEX idx_auth_links_cleanup ON auth_links(expiresAt, usedAt);

CREATE INDEX idx_dedupe_status ON dedupe_suggestions(status);

CREATE INDEX idx_dedupe_confidence ON dedupe_suggestions(confidence DESC);

CREATE INDEX idx_imports_owner_created ON imports(ownerId, createdAt DESC);

CREATE INDEX idx_import_rows_status ON import_rows(importId, status);

CREATE INDEX idx_score_snapshots_owner_week ON score_snapshots(ownerId, weekStart);

CREATE INDEX idx_search_history_owner_last
    ON search_history (ownerId, lastRunAt DESC, id DESC);

CREATE INDEX idx_search_history_owner_mode_last
    ON search_history (ownerId, mode, lastRunAt DESC, id DESC);

CREATE INDEX idx_search_history_owner_pinned
    ON search_history (ownerId, pinned, lastRunAt DESC, id DESC);

CREATE INDEX idx_connectors_owner ON connectors(ownerId, createdAt);

CREATE INDEX idx_connectors_due ON connectors(status, nextRunAt);

CREATE INDEX idx_connector_runs_conn ON connector_runs(connectorId, startedAt DESC);

CREATE INDEX idx_connector_links_local ON connector_links(localId);

CREATE INDEX idx_upcoming_owner_start ON upcoming_events(ownerId, startsAt);

CREATE INDEX idx_map_views_owner ON map_views(ownerId, sortOrder, name);

CREATE INDEX idx_contacts_owner_status    ON contacts(ownerId, isGhost, isArchived, canonicalId);

CREATE INDEX idx_contacts_owner_deleted   ON contacts(ownerId, deletedAt);

CREATE INDEX idx_contacts_owner_lastc     ON contacts(ownerId, lastContactedAt);

CREATE INDEX idx_contacts_owner_added     ON contacts(ownerId, addedAt);

CREATE INDEX idx_contacts_owner_score     ON contacts(ownerId, relationshipScore);

CREATE INDEX idx_contacts_owner_phonetic  ON contacts(ownerId, phoneticHash);

CREATE INDEX idx_contacts_owner_canon     ON contacts(ownerId, canonicalId);

CREATE INDEX idx_interactions_owner_date  ON interactions(ownerId, date);

CREATE INDEX idx_action_items_owner_due   ON action_items(ownerId, dueAt) WHERE completedAt IS NULL;

CREATE INDEX idx_action_items_owner_done  ON action_items(ownerId, completedAt);

CREATE INDEX idx_lists_owner_sort         ON lists(ownerId, sortOrder);

CREATE INDEX idx_dedupe_sugg_owner_status ON dedupe_suggestions(ownerId, status);

CREATE INDEX idx_dedupe_sugg_owner_conf   ON dedupe_suggestions(ownerId, confidence DESC);

CREATE INDEX idx_dedupe_excl_owner        ON dedupe_exclusions(ownerId);

CREATE INDEX idx_merge_log_owner_at       ON dedupe_merge_log(ownerId, mergedAt DESC);

CREATE INDEX idx_ai_inv_owner_created     ON ai_invocations(ownerId, createdAt DESC);

CREATE INDEX idx_contacts_deleted ON contacts(deletedAt);

CREATE INDEX idx_contacts_score_dirty
     ON contacts(ownerId) WHERE scoreDirty = 1;

CREATE INDEX idx_contacts_owner_tracked
     ON contacts(ownerId) WHERE isTracked = 1;

CREATE INDEX idx_action_items_contact ON action_items(contactId);

CREATE INDEX idx_action_items_due ON action_items(dueAt) WHERE completedAt IS NULL;

CREATE INDEX idx_contacts_phonetic ON contacts(phoneticHash);

CREATE INDEX idx_contact_emails_contact ON contact_emails(contactId);

CREATE INDEX idx_contact_phones_contact ON contact_phones(contactId);

CREATE INDEX idx_contact_social_links_contact ON contact_social_links(contactId);

CREATE INDEX idx_contact_education_contact ON contact_education(contactId);

CREATE INDEX idx_contact_experience_contact ON contact_experience(contactId);

CREATE INDEX idx_contact_sources_contact ON contact_sources(contactId);

CREATE INDEX idx_contact_tags_contact ON contact_tags(contactId);

CREATE INDEX idx_interactions_contact ON interactions(contactId);

CREATE INDEX idx_interaction_mentions_contact ON interaction_mentions(contactId);

CREATE INDEX idx_list_members_contact ON list_members(contactId);

CREATE INDEX idx_contacts_canonical ON contacts(canonicalId);

CREATE INDEX idx_contacts_status ON contacts(isGhost, isArchived, canonicalId);

CREATE INDEX idx_contacts_last_contacted ON contacts(lastContactedAt);

CREATE INDEX idx_contacts_added ON contacts(addedAt);

CREATE INDEX idx_contacts_score ON contacts(relationshipScore);
`;

/** The triggers that keep owners, edit times and derived columns right. */
const TRIGGERS = `
CREATE TRIGGER contacts_owner_required BEFORE INSERT ON contacts
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'contacts.ownerId is required'); END;

CREATE TRIGGER lists_owner_required BEFORE INSERT ON lists
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'lists.ownerId is required'); END;

CREATE TRIGGER dedupe_merge_log_owner_required BEFORE INSERT ON dedupe_merge_log
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'dedupe_merge_log.ownerId is required'); END;

CREATE TRIGGER ai_invocations_owner_required BEFORE INSERT ON ai_invocations
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'ai_invocations.ownerId is required'); END;

CREATE TRIGGER imports_owner_required BEFORE INSERT ON imports
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'imports.ownerId is required'); END;

CREATE TRIGGER score_snapshots_owner_required BEFORE INSERT ON score_snapshots
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'score_snapshots.ownerId is required'); END;

CREATE TRIGGER search_history_owner_required BEFORE INSERT ON search_history
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'search_history.ownerId is required'); END;

CREATE TRIGGER connectors_owner_required BEFORE INSERT ON connectors
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'connectors.ownerId is required'); END;

CREATE TRIGGER connector_runs_owner_required BEFORE INSERT ON connector_runs
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'connector_runs.ownerId is required'); END;

CREATE TRIGGER connector_links_owner_required BEFORE INSERT ON connector_links
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'connector_links.ownerId is required'); END;

CREATE TRIGGER upcoming_events_owner_required BEFORE INSERT ON upcoming_events
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'upcoming_events.ownerId is required'); END;

CREATE TRIGGER map_views_owner_required BEFORE INSERT ON map_views
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'map_views.ownerId is required'); END;

CREATE TRIGGER interactions_owner_fill AFTER INSERT ON interactions
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE interactions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
          WHERE id = NEW.id;
       END;

CREATE TRIGGER interactions_owner_check BEFORE INSERT ON interactions
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId))
       BEGIN SELECT RAISE(ABORT, 'interactions.ownerId does not match the contact owner'); END;

CREATE TRIGGER action_items_owner_fill AFTER INSERT ON action_items
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE action_items SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
          WHERE id = NEW.id;
       END;

CREATE TRIGGER action_items_owner_check BEFORE INSERT ON action_items
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId))
       BEGIN SELECT RAISE(ABORT, 'action_items.ownerId does not match the contact owner'); END;

CREATE TRIGGER dedupe_suggestions_owner_fill AFTER INSERT ON dedupe_suggestions
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE dedupe_suggestions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA)
          WHERE id = NEW.id;
       END;

CREATE TRIGGER dedupe_suggestions_owner_check BEFORE INSERT ON dedupe_suggestions
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA) OR NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdB))
       BEGIN SELECT RAISE(ABORT, 'dedupe_suggestions.ownerId does not match the contact owner'); END;

CREATE TRIGGER dedupe_exclusions_owner_fill AFTER INSERT ON dedupe_exclusions
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE dedupe_exclusions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA)
          WHERE contactIdA = NEW.contactIdA AND contactIdB = NEW.contactIdB;
       END;

CREATE TRIGGER dedupe_exclusions_owner_check BEFORE INSERT ON dedupe_exclusions
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA) OR NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdB))
       BEGIN SELECT RAISE(ABORT, 'dedupe_exclusions.ownerId does not match the contact owner'); END;

CREATE TRIGGER contacts_owner_propagate AFTER UPDATE OF ownerId ON contacts
     WHEN NEW.ownerId IS NOT OLD.ownerId
     BEGIN
       UPDATE interactions       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
       UPDATE action_items       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
       UPDATE dedupe_suggestions SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
       UPDATE dedupe_exclusions  SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
     END;

CREATE TRIGGER contacts_auto_updated_at
  AFTER UPDATE OF "id", "name", "firstName", "lastName", "headline", "role", "company", "location", "birthday", "preferences", "avatarUrl", "addedAt", "updatedAt", "cadenceDays", "lastContactedAt", "nextFollowUpAt", "themeColor", "about", "pronouns", "industry", "website", "aiBriefing", "aiBackground", "aiSummary", "aiHydratedAt", "aiBriefingAt", "isGhost", "isArchived", "searchExpansion", "deletedAt", "canonicalId", "phoneticHash", "isTracked", "trackedAt", "aiResearch", "ownerId" ON contacts
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE contacts SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

CREATE TRIGGER contacts_score_dirty
  AFTER UPDATE OF "id", "name", "firstName", "lastName", "headline", "role", "company", "location", "birthday", "preferences", "avatarUrl", "addedAt", "updatedAt", "cadenceDays", "lastContactedAt", "nextFollowUpAt", "themeColor", "about", "pronouns", "industry", "website", "aiBriefing", "aiBackground", "aiSummary", "aiHydratedAt", "aiBriefingAt", "isGhost", "isArchived", "searchExpansion", "deletedAt", "canonicalId", "phoneticHash", "isTracked", "trackedAt", "aiResearch", "ownerId" ON contacts
  FOR EACH ROW
  WHEN NEW.scoreDirty = 0
  BEGIN
    UPDATE contacts SET scoreDirty = 1 WHERE id = NEW.id;
  END;

CREATE TRIGGER contacts_track_stamp_ins
  AFTER INSERT ON contacts
  FOR EACH ROW
  WHEN NEW.isTracked = 1 AND NEW.trackedAt IS NULL
  BEGIN
    UPDATE contacts SET trackedAt = datetime('now') WHERE id = NEW.id;
  END;

CREATE TRIGGER contacts_track_stamp_upd
  AFTER UPDATE OF isTracked ON contacts
  FOR EACH ROW
  WHEN NEW.isTracked != OLD.isTracked
  BEGIN
    UPDATE contacts
       SET trackedAt = CASE WHEN NEW.isTracked = 1 THEN datetime('now') ELSE NULL END
     WHERE id = NEW.id;
  END;

CREATE TRIGGER interactions_auto_updated_at AFTER UPDATE ON interactions
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE interactions SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

CREATE TRIGGER action_items_auto_updated_at AFTER UPDATE ON action_items
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE action_items SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

CREATE TRIGGER action_items_sync_insert AFTER INSERT ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = NEW.contactId AND completedAt IS NULL
    ) WHERE id = NEW.contactId;
  END;

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

CREATE TRIGGER action_items_sync_delete AFTER DELETE ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = OLD.contactId AND completedAt IS NULL
    ) WHERE id = OLD.contactId;
  END;

CREATE TRIGGER interactions_score_dirty_ins AFTER INSERT ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = NEW.contactId AND scoreDirty = 0;
  END;

CREATE TRIGGER interactions_score_dirty_upd AFTER UPDATE ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id IN (NEW.contactId, OLD.contactId) AND scoreDirty = 0;
  END;

CREATE TRIGGER interactions_score_dirty_del AFTER DELETE ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = OLD.contactId AND scoreDirty = 0;
  END;

CREATE TRIGGER action_items_score_dirty_ins AFTER INSERT ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = NEW.contactId AND scoreDirty = 0;
  END;

CREATE TRIGGER action_items_score_dirty_upd AFTER UPDATE ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id IN (NEW.contactId, OLD.contactId) AND scoreDirty = 0;
  END;

CREATE TRIGGER action_items_score_dirty_del AFTER DELETE ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = OLD.contactId AND scoreDirty = 0;
  END;
`;
