-- =============================================================================
-- Schema fixture: a new database booted at d67c8a9 (v2.0, 2026-10-03)
-- =============================================================================
-- Made by a scratch script, not committed, that ran the unchanged code at
-- d67c8a9 with DATA_DIR set to an empty folder. It imported server/db.ts and
-- then server/services/geocoding/cache.ts, which creates geocode_cache when it
-- is imported, so the database is the one a full app boot leaves. It then read
-- every sqlite_master row whose name does not start with "sqlite_": 236 of the
-- 312 rows, with 6 virtual tables.
--
-- The file compares and builds.
--
-- - Each object is one block. Its first line is "-- <kind> <name>", and the
--   rest is the sql column of its sqlite_master row, byte for byte, then ";".
--   No stored statement holds a blank line, so a blank line ends a block.
-- - The kinds are table, virtual table, shadow table, index and trigger. A
--   virtual table creates its shadow tables, so each shadow table's statement
--   is a comment after its virtual table. It still takes part in the
--   comparison. A shadow table is a table whose name starts with the name of a
--   virtual table and "_". PRAGMA table_list does not mark the vec0
--   "_vector_chunks00" tables as shadow, and this rule does.
-- - Run top to bottom, the file builds the database: plain tables, virtual
--   tables, indexes, then triggers, each group by name. Building needs
--   sqlite-vec loaded on the connection, for the vec0 tables.
-- - Contrack 2 starts fresh, so the baseline migration does not create
--   drizzle-orm's "__drizzle_migrations" table, and the block for it and the
--   bookkeeping rows a d67c8a9 database carried are gone from this file.
-- =============================================================================

-- Plain tables, by name.

-- table action_items
CREATE TABLE `action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`interactionId` text,
	`title` text NOT NULL,
	`dueAt` text NOT NULL,
	`completedAt` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP), ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interactionId`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE set null
);

-- table ai_invocations
CREATE TABLE `ai_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`model` text,
	`tokenCount` integer,
	`latencyMs` integer NOT NULL,
	`cached` integer DEFAULT 0 NOT NULL,
	`description` text,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL
, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT);

-- table api_tokens
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

-- table app_settings
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

-- table audit_log
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

-- table auth_challenges
CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    userId TEXT REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL
  );

-- table auth_links
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

-- table connector_links
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

-- table connector_runs
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

-- table connectors
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

-- table contact_addresses
CREATE TABLE `contact_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`address` text NOT NULL,
	`label` text DEFAULT 'home',
	`isPrimary` integer DEFAULT 0,
	`sortOrder` integer DEFAULT 0,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_attributes
CREATE TABLE `contact_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_education
CREATE TABLE `contact_education` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`school` text NOT NULL,
	`degree` text,
	`fieldOfStudy` text,
	`startDate` text,
	`endDate` text,
	`description` text,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_emails
CREATE TABLE `contact_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`email` text NOT NULL,
	`label` text DEFAULT 'personal',
	`isPrimary` integer DEFAULT 0,
	`sortOrder` integer DEFAULT 0,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_experience
CREATE TABLE `contact_experience` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`company` text NOT NULL,
	`role` text,
	`startDate` text,
	`endDate` text,
	`isCurrent` integer DEFAULT 0,
	`description` text,
	`location` text,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_interests
CREATE TABLE `contact_interests` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`interest` text NOT NULL,
	`isAiGenerated` integer DEFAULT false,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_phones
CREATE TABLE `contact_phones` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`phone` text NOT NULL,
	`label` text DEFAULT 'mobile',
	`isPrimary` integer DEFAULT 0,
	`sortOrder` integer DEFAULT 0,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_social_links
CREATE TABLE `contact_social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`platform` text NOT NULL,
	`url` text NOT NULL,
	`handle` text,
	`source` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_sources
CREATE TABLE `contact_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`platform` text NOT NULL,
	`externalId` text,
	`connectedOn` text,
	`importedAt` text DEFAULT (CURRENT_TIMESTAMP),
	`rawData` text,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contact_tags
CREATE TABLE `contact_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`tag` text NOT NULL,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table contacts
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`firstName` text,
	`lastName` text,
	`headline` text,
	`role` text,
	`company` text,
	`location` text,
	`birthday` text,
	`preferences` text,
	`avatarUrl` text,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP),
	`cadenceDays` integer DEFAULT 90,
	`lastContactedAt` text,
	`nextFollowUpAt` text,
	`themeColor` text DEFAULT 'brand',
	`about` text,
	`pronouns` text,
	`industry` text,
	`website` text,
	`lat` real,
	`lng` real,
	`aiBriefing` text,
	`aiBackground` text,
	`aiSummary` text,
	`aiHydratedAt` text,
	`aiBriefingAt` text,
	`isGhost` integer DEFAULT 0,
	`isArchived` integer DEFAULT 0,
	`relationshipScore` integer DEFAULT 50
, searchExpansion TEXT, deletedAt TEXT, canonicalId TEXT, phoneticHash TEXT, geoSource TEXT, isTracked INTEGER NOT NULL DEFAULT 0, trackedAt TEXT, aiResearch TEXT, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT, scoreDirty INTEGER NOT NULL DEFAULT 1);

-- table dedupe_embedding_meta
CREATE TABLE dedupe_embedding_meta (
    contactId TEXT PRIMARY KEY,
    embeddedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

-- table dedupe_exclusions
CREATE TABLE dedupe_exclusions (
    contactIdA TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contactIdB TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP), ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
    PRIMARY KEY (contactIdA, contactIdB)
  );

-- table dedupe_merge_log
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

-- table dedupe_suggestions
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

-- table geocode_cache
CREATE TABLE geocode_cache (
    key       TEXT PRIMARY KEY,
    lat       REAL,
    lng       REAL,
    provider  TEXT NOT NULL,
    success   INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

-- table import_rows
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

-- table imports
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

-- table interaction_mentions
CREATE TABLE `interaction_mentions` (
	`interactionId` text NOT NULL,
	`contactId` text NOT NULL,
	PRIMARY KEY(`interactionId`, `contactId`),
	FOREIGN KEY (`interactionId`) REFERENCES `interactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table interactions
CREATE TABLE `interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`date` text DEFAULT (CURRENT_TIMESTAMP),
	`duration` text,
	`fileUrl` text,
	`fileName` text,
	`fileType` text,
	`source` text,
	`mentions` text,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP), ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table invitations
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

-- table list_members
CREATE TABLE `list_members` (
	`listId` text NOT NULL,
	`contactId` text NOT NULL,
	`addedAt` text DEFAULT (CURRENT_TIMESTAMP),
	PRIMARY KEY(`listId`, `contactId`),
	FOREIGN KEY (`listId`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table lists
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'star' NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP)
, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT);

-- table map_views
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

-- table notes_revision
CREATE TABLE notes_revision (
        ownerId TEXT PRIMARY KEY,
        revision INTEGER NOT NULL
      );

-- table oauth_states
CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    codeVerifier TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );

-- table passkeys
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

-- table score_snapshots
CREATE TABLE score_snapshots (
    ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    weekStart TEXT NOT NULL,
    score REAL NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (contactId, weekStart)
  );

-- table search_history
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

-- table search_index_queue
CREATE TABLE search_index_queue (
      contactId TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      queuedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      nextAttemptAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      contactUpdatedAt TEXT
    );

-- table search_passage_state
CREATE TABLE `search_passage_state` (
	`contactId` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`representationVersion` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`signature` text NOT NULL,
	`indexedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table search_passages
CREATE TABLE `search_passages` (
	`id` text PRIMARY KEY NOT NULL,
	`contactId` text NOT NULL,
	`ownerId` text NOT NULL,
	`field` text NOT NULL,
	`sourceId` text NOT NULL,
	`sourceHash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`context` text NOT NULL,
	`startOffset` integer NOT NULL,
	`endOffset` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

-- table search_revision
CREATE TABLE search_revision (
        ownerId TEXT PRIMARY KEY,
        revision INTEGER NOT NULL
      );

-- table sessions
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expiresAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    userAgent TEXT,
    method TEXT
  );

-- table upcoming_events
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

-- table user_settings
CREATE TABLE user_settings (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (userId, key)
  );

-- table users
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

-- Virtual tables, by name. Each is followed by the shadow tables it creates.

-- virtual table contact_embeddings
CREATE VIRTUAL TABLE contact_embeddings USING vec0(
    contactId TEXT PRIMARY KEY,
    ownerId TEXT PARTITION KEY,
    isGhost INTEGER,
    isArchived INTEGER,
    active INTEGER,
    embedding FLOAT[768]
  );

-- shadow table contact_embeddings_chunks
-- CREATE TABLE "contact_embeddings_chunks"(chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,size INTEGER NOT NULL,sequence_id integer,partition00,validity BLOB NOT NULL, rowids BLOB NOT NULL);

-- shadow table contact_embeddings_info
-- CREATE TABLE "contact_embeddings_info" (key text primary key, value any);

-- shadow table contact_embeddings_metadatachunks00
-- CREATE TABLE "contact_embeddings_metadatachunks00"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table contact_embeddings_metadatachunks01
-- CREATE TABLE "contact_embeddings_metadatachunks01"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table contact_embeddings_metadatachunks02
-- CREATE TABLE "contact_embeddings_metadatachunks02"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table contact_embeddings_rowids
-- CREATE TABLE "contact_embeddings_rowids"(rowid INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,chunk_id INTEGER,chunk_offset INTEGER);

-- shadow table contact_embeddings_vector_chunks00
-- CREATE TABLE "contact_embeddings_vector_chunks00"(rowid PRIMARY KEY,vectors BLOB NOT NULL);

-- virtual table contacts_fts
CREATE VIRTUAL TABLE contacts_fts USING fts5(
        contactId UNINDEXED, name, company, role, headline, location, about, industry, tags, extras, addresses, searchExpansion,
        ownerTok,
        prefix='2 3 4'
      );

-- shadow table contacts_fts_config
-- CREATE TABLE 'contacts_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

-- shadow table contacts_fts_content
-- CREATE TABLE 'contacts_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12);

-- shadow table contacts_fts_data
-- CREATE TABLE 'contacts_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

-- shadow table contacts_fts_docsize
-- CREATE TABLE 'contacts_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

-- shadow table contacts_fts_idx
-- CREATE TABLE 'contacts_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

-- virtual table interactions_fts
CREATE VIRTUAL TABLE interactions_fts USING fts5(
      interactionId UNINDEXED, title, content, ownerTok,
      tokenize = 'porter unicode61 remove_diacritics 2'
    );

-- shadow table interactions_fts_config
-- CREATE TABLE 'interactions_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

-- shadow table interactions_fts_content
-- CREATE TABLE 'interactions_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2, c3);

-- shadow table interactions_fts_data
-- CREATE TABLE 'interactions_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

-- shadow table interactions_fts_docsize
-- CREATE TABLE 'interactions_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

-- shadow table interactions_fts_idx
-- CREATE TABLE 'interactions_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

-- virtual table search_embeddings
CREATE VIRTUAL TABLE search_embeddings USING vec0(
    contactId TEXT PRIMARY KEY,
    ownerId TEXT PARTITION KEY,
    isGhost INTEGER,
    isArchived INTEGER,
    active INTEGER,
    embedding INT8[384]
  );

-- shadow table search_embeddings_chunks
-- CREATE TABLE "search_embeddings_chunks"(chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,size INTEGER NOT NULL,sequence_id integer,partition00,validity BLOB NOT NULL, rowids BLOB NOT NULL);

-- shadow table search_embeddings_info
-- CREATE TABLE "search_embeddings_info" (key text primary key, value any);

-- shadow table search_embeddings_metadatachunks00
-- CREATE TABLE "search_embeddings_metadatachunks00"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table search_embeddings_metadatachunks01
-- CREATE TABLE "search_embeddings_metadatachunks01"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table search_embeddings_metadatachunks02
-- CREATE TABLE "search_embeddings_metadatachunks02"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table search_embeddings_rowids
-- CREATE TABLE "search_embeddings_rowids"(rowid INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,chunk_id INTEGER,chunk_offset INTEGER);

-- shadow table search_embeddings_vector_chunks00
-- CREATE TABLE "search_embeddings_vector_chunks00"(rowid PRIMARY KEY,vectors BLOB NOT NULL);

-- virtual table search_passage_vectors
CREATE VIRTUAL TABLE search_passage_vectors USING vec0(
    passageId TEXT PRIMARY KEY, ownerId TEXT PARTITION KEY,
    isGhost INTEGER, isArchived INTEGER, active INTEGER,
    embedding INT8[384]
  );

-- shadow table search_passage_vectors_chunks
-- CREATE TABLE "search_passage_vectors_chunks"(chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,size INTEGER NOT NULL,sequence_id integer,partition00,validity BLOB NOT NULL, rowids BLOB NOT NULL);

-- shadow table search_passage_vectors_info
-- CREATE TABLE "search_passage_vectors_info" (key text primary key, value any);

-- shadow table search_passage_vectors_metadatachunks00
-- CREATE TABLE "search_passage_vectors_metadatachunks00"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table search_passage_vectors_metadatachunks01
-- CREATE TABLE "search_passage_vectors_metadatachunks01"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table search_passage_vectors_metadatachunks02
-- CREATE TABLE "search_passage_vectors_metadatachunks02"(rowid PRIMARY KEY, data BLOB NOT NULL);

-- shadow table search_passage_vectors_rowids
-- CREATE TABLE "search_passage_vectors_rowids"(rowid INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,chunk_id INTEGER,chunk_offset INTEGER);

-- shadow table search_passage_vectors_vector_chunks00
-- CREATE TABLE "search_passage_vectors_vector_chunks00"(rowid PRIMARY KEY,vectors BLOB NOT NULL);

-- virtual table search_passages_fts
CREATE VIRTUAL TABLE search_passages_fts USING fts5(
      text, ownerTok, tokenize = 'unicode61 remove_diacritics 2'
    );

-- shadow table search_passages_fts_config
-- CREATE TABLE 'search_passages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;

-- shadow table search_passages_fts_content
-- CREATE TABLE 'search_passages_fts_content'(id INTEGER PRIMARY KEY, c0, c1);

-- shadow table search_passages_fts_data
-- CREATE TABLE 'search_passages_fts_data'(id INTEGER PRIMARY KEY, block BLOB);

-- shadow table search_passages_fts_docsize
-- CREATE TABLE 'search_passages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);

-- shadow table search_passages_fts_idx
-- CREATE TABLE 'search_passages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;

-- Indexes, by name.

-- index contact_addresses_contactId_address_unique
CREATE UNIQUE INDEX `contact_addresses_contactId_address_unique` ON `contact_addresses` (`contactId`,`address`);

-- index contact_attributes_contactId_name_unique
CREATE UNIQUE INDEX `contact_attributes_contactId_name_unique` ON `contact_attributes` (`contactId`,`name`);

-- index contact_interests_contactId_interest_unique
CREATE UNIQUE INDEX `contact_interests_contactId_interest_unique` ON `contact_interests` (`contactId`,`interest`);

-- index idx_action_items_contact
CREATE INDEX idx_action_items_contact ON action_items(contactId);

-- index idx_action_items_due
CREATE INDEX idx_action_items_due ON action_items(dueAt) WHERE completedAt IS NULL;

-- index idx_action_items_owner_done
CREATE INDEX idx_action_items_owner_done  ON action_items(ownerId, completedAt);

-- index idx_action_items_owner_due
CREATE INDEX idx_action_items_owner_due   ON action_items(ownerId, dueAt) WHERE completedAt IS NULL;

-- index idx_ai_inv_owner_created
CREATE INDEX idx_ai_inv_owner_created     ON ai_invocations(ownerId, createdAt DESC);

-- index idx_ai_invocations_created
CREATE INDEX `idx_ai_invocations_created` ON `ai_invocations` (`createdAt` DESC);

-- index idx_api_tokens_user
CREATE INDEX idx_api_tokens_user ON api_tokens(userId);

-- index idx_audit_actor
CREATE INDEX idx_audit_actor ON audit_log(actorUserId, createdAt DESC);

-- index idx_audit_created
CREATE INDEX idx_audit_created ON audit_log(createdAt DESC);

-- index idx_auth_challenges_expires
CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expiresAt);

-- index idx_auth_links_cleanup
CREATE INDEX idx_auth_links_cleanup ON auth_links(expiresAt, usedAt);

-- index idx_auth_links_user
CREATE INDEX idx_auth_links_user ON auth_links(userId, createdAt);

-- index idx_connector_links_local
CREATE INDEX idx_connector_links_local ON connector_links(localId);

-- index idx_connector_runs_conn
CREATE INDEX idx_connector_runs_conn ON connector_runs(connectorId, startedAt DESC);

-- index idx_connectors_due
CREATE INDEX idx_connectors_due ON connectors(status, nextRunAt);

-- index idx_connectors_owner
CREATE INDEX idx_connectors_owner ON connectors(ownerId, createdAt);

-- index idx_contact_education_contact
CREATE INDEX idx_contact_education_contact ON contact_education(contactId);

-- index idx_contact_emails_contact
CREATE INDEX idx_contact_emails_contact ON contact_emails(contactId);

-- index idx_contact_experience_contact
CREATE INDEX idx_contact_experience_contact ON contact_experience(contactId);

-- index idx_contact_phones_contact
CREATE INDEX idx_contact_phones_contact ON contact_phones(contactId);

-- index idx_contact_social_links_contact
CREATE INDEX idx_contact_social_links_contact ON contact_social_links(contactId);

-- index idx_contact_sources_contact
CREATE INDEX idx_contact_sources_contact ON contact_sources(contactId);

-- index idx_contact_tags_contact
CREATE INDEX idx_contact_tags_contact ON contact_tags(contactId);

-- index idx_contacts_added
CREATE INDEX idx_contacts_added ON contacts(addedAt);

-- index idx_contacts_canonical
CREATE INDEX idx_contacts_canonical ON contacts(canonicalId);

-- index idx_contacts_deleted
CREATE INDEX idx_contacts_deleted ON contacts(deletedAt);

-- index idx_contacts_last_contacted
CREATE INDEX idx_contacts_last_contacted ON contacts(lastContactedAt);

-- index idx_contacts_owner_added
CREATE INDEX idx_contacts_owner_added     ON contacts(ownerId, addedAt);

-- index idx_contacts_owner_canon
CREATE INDEX idx_contacts_owner_canon     ON contacts(ownerId, canonicalId);

-- index idx_contacts_owner_deleted
CREATE INDEX idx_contacts_owner_deleted   ON contacts(ownerId, deletedAt);

-- index idx_contacts_owner_lastc
CREATE INDEX idx_contacts_owner_lastc     ON contacts(ownerId, lastContactedAt);

-- index idx_contacts_owner_phonetic
CREATE INDEX idx_contacts_owner_phonetic  ON contacts(ownerId, phoneticHash);

-- index idx_contacts_owner_score
CREATE INDEX idx_contacts_owner_score     ON contacts(ownerId, relationshipScore);

-- index idx_contacts_owner_status
CREATE INDEX idx_contacts_owner_status    ON contacts(ownerId, isGhost, isArchived, canonicalId);

-- index idx_contacts_owner_tracked
CREATE INDEX idx_contacts_owner_tracked
     ON contacts(ownerId) WHERE isTracked = 1;

-- index idx_contacts_phonetic
CREATE INDEX idx_contacts_phonetic ON contacts(phoneticHash);

-- index idx_contacts_score
CREATE INDEX idx_contacts_score ON contacts(relationshipScore);

-- index idx_contacts_score_dirty
CREATE INDEX idx_contacts_score_dirty
     ON contacts(ownerId) WHERE scoreDirty = 1;

-- index idx_contacts_status
CREATE INDEX idx_contacts_status ON contacts(isGhost, isArchived, canonicalId);

-- index idx_dedupe_confidence
CREATE INDEX idx_dedupe_confidence ON dedupe_suggestions(confidence DESC);

-- index idx_dedupe_excl_owner
CREATE INDEX idx_dedupe_excl_owner        ON dedupe_exclusions(ownerId);

-- index idx_dedupe_status
CREATE INDEX idx_dedupe_status ON dedupe_suggestions(status);

-- index idx_dedupe_sugg_owner_conf
CREATE INDEX idx_dedupe_sugg_owner_conf   ON dedupe_suggestions(ownerId, confidence DESC);

-- index idx_dedupe_sugg_owner_status
CREATE INDEX idx_dedupe_sugg_owner_status ON dedupe_suggestions(ownerId, status);

-- index idx_import_rows_status
CREATE INDEX idx_import_rows_status ON import_rows(importId, status);

-- index idx_imports_owner_created
CREATE INDEX idx_imports_owner_created ON imports(ownerId, createdAt DESC);

-- index idx_interaction_mentions_contact
CREATE INDEX idx_interaction_mentions_contact ON interaction_mentions(contactId);

-- index idx_interactions_contact
CREATE INDEX idx_interactions_contact ON interactions(contactId);

-- index idx_interactions_owner_date
CREATE INDEX idx_interactions_owner_date  ON interactions(ownerId, date);

-- index idx_list_members_contact
CREATE INDEX idx_list_members_contact ON list_members(contactId);

-- index idx_lists_owner_sort
CREATE INDEX idx_lists_owner_sort         ON lists(ownerId, sortOrder);

-- index idx_map_views_owner
CREATE INDEX idx_map_views_owner ON map_views(ownerId, sortOrder, name);

-- index idx_merge_log_owner_at
CREATE INDEX idx_merge_log_owner_at       ON dedupe_merge_log(ownerId, mergedAt DESC);

-- index idx_passkeys_user
CREATE INDEX idx_passkeys_user ON passkeys(userId);

-- index idx_score_snapshots_owner_week
CREATE INDEX idx_score_snapshots_owner_week ON score_snapshots(ownerId, weekStart);

-- index idx_search_history_owner_last
CREATE INDEX idx_search_history_owner_last
    ON search_history (ownerId, lastRunAt DESC, id DESC);

-- index idx_search_history_owner_mode_last
CREATE INDEX idx_search_history_owner_mode_last
    ON search_history (ownerId, mode, lastRunAt DESC, id DESC);

-- index idx_search_history_owner_pinned
CREATE INDEX idx_search_history_owner_pinned
    ON search_history (ownerId, pinned, lastRunAt DESC, id DESC);

-- index idx_search_index_queue_owner
CREATE INDEX idx_search_index_queue_owner
      ON search_index_queue (ownerId, status);

-- index idx_search_index_queue_status_next
CREATE INDEX idx_search_index_queue_status_next
      ON search_index_queue (status, nextAttemptAt);

-- index idx_search_passage_state_owner
CREATE INDEX `idx_search_passage_state_owner` ON `search_passage_state` (`ownerId`);

-- index idx_search_passages_contact
CREATE INDEX `idx_search_passages_contact` ON `search_passages` (`contactId`);

-- index idx_search_passages_owner
CREATE INDEX `idx_search_passages_owner` ON `search_passages` (`ownerId`);

-- index idx_sessions_expires
CREATE INDEX idx_sessions_expires ON sessions(expiresAt);

-- index idx_sessions_user
CREATE INDEX idx_sessions_user ON sessions(userId);

-- index idx_upcoming_owner_start
CREATE INDEX idx_upcoming_owner_start ON upcoming_events(ownerId, startsAt);

-- Triggers, by name.

-- trigger action_items_auto_updated_at
CREATE TRIGGER action_items_auto_updated_at AFTER UPDATE ON action_items
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE action_items SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

-- trigger action_items_owner_check
CREATE TRIGGER action_items_owner_check BEFORE INSERT ON action_items
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId))
       BEGIN SELECT RAISE(ABORT, 'action_items.ownerId does not match the contact owner'); END;

-- trigger action_items_owner_fill
CREATE TRIGGER action_items_owner_fill AFTER INSERT ON action_items
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE action_items SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
          WHERE id = NEW.id;
       END;

-- trigger action_items_score_dirty_del
CREATE TRIGGER action_items_score_dirty_del AFTER DELETE ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = OLD.contactId AND scoreDirty = 0;
  END;

-- trigger action_items_score_dirty_ins
CREATE TRIGGER action_items_score_dirty_ins AFTER INSERT ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = NEW.contactId AND scoreDirty = 0;
  END;

-- trigger action_items_score_dirty_upd
CREATE TRIGGER action_items_score_dirty_upd AFTER UPDATE ON action_items
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id IN (NEW.contactId, OLD.contactId) AND scoreDirty = 0;
  END;

-- trigger action_items_sync_delete
CREATE TRIGGER action_items_sync_delete AFTER DELETE ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = OLD.contactId AND completedAt IS NULL
    ) WHERE id = OLD.contactId;
  END;

-- trigger action_items_sync_insert
CREATE TRIGGER action_items_sync_insert AFTER INSERT ON action_items BEGIN
    UPDATE contacts SET nextFollowUpAt = (
      SELECT MIN(dueAt) FROM action_items
      WHERE contactId = NEW.contactId AND completedAt IS NULL
    ) WHERE id = NEW.contactId;
  END;

-- trigger action_items_sync_update
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

-- trigger ai_invocations_owner_required
CREATE TRIGGER ai_invocations_owner_required BEFORE INSERT ON ai_invocations
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'ai_invocations.ownerId is required'); END;

-- trigger connector_links_owner_required
CREATE TRIGGER connector_links_owner_required BEFORE INSERT ON connector_links
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'connector_links.ownerId is required'); END;

-- trigger connector_runs_owner_required
CREATE TRIGGER connector_runs_owner_required BEFORE INSERT ON connector_runs
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'connector_runs.ownerId is required'); END;

-- trigger connectors_owner_required
CREATE TRIGGER connectors_owner_required BEFORE INSERT ON connectors
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'connectors.ownerId is required'); END;

-- trigger contact_embeddings_status
CREATE TRIGGER contact_embeddings_status
      AFTER UPDATE OF isGhost, isArchived, deletedAt, canonicalId ON contacts
      WHEN NEW.isGhost IS NOT OLD.isGhost
        OR NEW.isArchived IS NOT OLD.isArchived
        OR NEW.deletedAt IS NOT OLD.deletedAt
        OR NEW.canonicalId IS NOT OLD.canonicalId
    BEGIN
      UPDATE contact_embeddings
         SET isGhost = NEW.isGhost,
             isArchived = COALESCE(NEW.isArchived, 0),
             active = (NEW.deletedAt IS NULL AND NEW.canonicalId IS NULL)
       WHERE contactId = NEW.id;
    END;

-- trigger contacts_ad
CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
      END;

-- trigger contacts_ai
CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
        INSERT INTO contacts_fts(rowid, contactId, name, company, role, headline, location, about, industry, tags, extras, addresses, searchExpansion, ownerTok) SELECT c.rowid, c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
  COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), ''),
  COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(phone || CASE WHEN d = '' OR d GLOB '*[^0-9]*' THEN ''
    ELSE ' ' || d
      || CASE WHEN length(d) > 10 THEN ' ' || substr(d, -10) ELSE '' END
      || CASE WHEN length(d) > 7 THEN ' ' || substr(d, -7) ELSE '' END END, ' ')
    FROM (SELECT phone, replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), '+', ''), '/', ''), '\', ''), char(9), ''), char(160), ''), char(8201), ''), char(8209), ''), char(8211), ''), char(8212), ''), char(8239), '') AS d FROM contact_phones WHERE contactId = c.id)), ''),
  COALESCE((SELECT GROUP_CONCAT(address, ' ') FROM contact_addresses WHERE contactId = c.id), ''),
  COALESCE(c.searchExpansion, ''), 'o' || replace(c.ownerId, '-', '')
        FROM contacts c WHERE c.id = new.id AND c.isGhost = 0 AND COALESCE(c.isArchived, 0) = 0
  AND c.canonicalId IS NULL AND c.deletedAt IS NULL;
      END;

-- trigger contacts_au
CREATE TRIGGER contacts_au AFTER UPDATE OF id, name, company, role, headline, location, about, industry, preferences, searchExpansion, isGhost, isArchived, canonicalId, deletedAt, ownerId ON contacts BEGIN
        DELETE FROM contacts_fts WHERE rowid = old.rowid;
        INSERT INTO contacts_fts(rowid, contactId, name, company, role, headline, location, about, industry, tags, extras, addresses, searchExpansion, ownerTok) SELECT c.rowid, c.id, c.name, c.company, c.role, c.headline, c.location, c.about, c.industry,
  COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM contact_tags WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(interest, ' ') FROM contact_interests WHERE contactId = c.id), ''),
  COALESCE((SELECT GROUP_CONCAT(email, ' ') FROM contact_emails WHERE contactId = c.id), '') || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(phone || CASE WHEN d = '' OR d GLOB '*[^0-9]*' THEN ''
    ELSE ' ' || d
      || CASE WHEN length(d) > 10 THEN ' ' || substr(d, -10) ELSE '' END
      || CASE WHEN length(d) > 7 THEN ' ' || substr(d, -7) ELSE '' END END, ' ')
    FROM (SELECT phone, replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), '+', ''), '/', ''), '\', ''), char(9), ''), char(160), ''), char(8201), ''), char(8209), ''), char(8211), ''), char(8212), ''), char(8239), '') AS d FROM contact_phones WHERE contactId = c.id)), ''),
  COALESCE((SELECT GROUP_CONCAT(address, ' ') FROM contact_addresses WHERE contactId = c.id), ''),
  COALESCE(c.searchExpansion, ''), 'o' || replace(c.ownerId, '-', '')
        FROM contacts c WHERE c.id = new.id AND c.isGhost = 0 AND COALESCE(c.isArchived, 0) = 0
  AND c.canonicalId IS NULL AND c.deletedAt IS NULL;
      END;

-- trigger contacts_auto_updated_at
CREATE TRIGGER contacts_auto_updated_at
  AFTER UPDATE OF "id", "name", "firstName", "lastName", "headline", "role", "company", "location", "birthday", "preferences", "avatarUrl", "addedAt", "updatedAt", "cadenceDays", "lastContactedAt", "nextFollowUpAt", "themeColor", "about", "pronouns", "industry", "website", "lat", "lng", "aiBriefing", "aiBackground", "aiSummary", "aiHydratedAt", "aiBriefingAt", "isGhost", "isArchived", "searchExpansion", "deletedAt", "canonicalId", "phoneticHash", "geoSource", "isTracked", "trackedAt", "aiResearch", "ownerId" ON contacts
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE contacts SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

-- trigger contacts_owner_propagate
CREATE TRIGGER contacts_owner_propagate AFTER UPDATE OF ownerId ON contacts
     WHEN NEW.ownerId IS NOT OLD.ownerId
     BEGIN
       UPDATE interactions       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
       UPDATE action_items       SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
       UPDATE dedupe_suggestions SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
       UPDATE dedupe_exclusions  SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
     END;

-- trigger contacts_owner_required
CREATE TRIGGER contacts_owner_required BEFORE INSERT ON contacts
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'contacts.ownerId is required'); END;

-- trigger contacts_score_dirty
CREATE TRIGGER contacts_score_dirty
  AFTER UPDATE OF "id", "name", "firstName", "lastName", "headline", "role", "company", "location", "birthday", "preferences", "avatarUrl", "addedAt", "updatedAt", "cadenceDays", "lastContactedAt", "nextFollowUpAt", "themeColor", "about", "pronouns", "industry", "website", "lat", "lng", "aiBriefing", "aiBackground", "aiSummary", "aiHydratedAt", "aiBriefingAt", "isGhost", "isArchived", "searchExpansion", "deletedAt", "canonicalId", "phoneticHash", "geoSource", "isTracked", "trackedAt", "aiResearch", "ownerId" ON contacts
  FOR EACH ROW
  WHEN NEW.scoreDirty = 0
  BEGIN
    UPDATE contacts SET scoreDirty = 1 WHERE id = NEW.id;
  END;

-- trigger contacts_track_stamp_ins
CREATE TRIGGER contacts_track_stamp_ins
  AFTER INSERT ON contacts
  FOR EACH ROW
  WHEN NEW.isTracked = 1 AND NEW.trackedAt IS NULL
  BEGIN
    UPDATE contacts SET trackedAt = datetime('now') WHERE id = NEW.id;
  END;

-- trigger contacts_track_stamp_upd
CREATE TRIGGER contacts_track_stamp_upd
  AFTER UPDATE OF isTracked ON contacts
  FOR EACH ROW
  WHEN NEW.isTracked != OLD.isTracked
  BEGIN
    UPDATE contacts
       SET trackedAt = CASE WHEN NEW.isTracked = 1 THEN datetime('now') ELSE NULL END
     WHERE id = NEW.id;
  END;

-- trigger dedupe_exclusions_owner_check
CREATE TRIGGER dedupe_exclusions_owner_check BEFORE INSERT ON dedupe_exclusions
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA) OR NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdB))
       BEGIN SELECT RAISE(ABORT, 'dedupe_exclusions.ownerId does not match the contact owner'); END;

-- trigger dedupe_exclusions_owner_fill
CREATE TRIGGER dedupe_exclusions_owner_fill AFTER INSERT ON dedupe_exclusions
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE dedupe_exclusions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA)
          WHERE contactIdA = NEW.contactIdA AND contactIdB = NEW.contactIdB;
       END;

-- trigger dedupe_merge_log_owner_required
CREATE TRIGGER dedupe_merge_log_owner_required BEFORE INSERT ON dedupe_merge_log
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'dedupe_merge_log.ownerId is required'); END;

-- trigger dedupe_suggestions_owner_check
CREATE TRIGGER dedupe_suggestions_owner_check BEFORE INSERT ON dedupe_suggestions
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA) OR NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactIdB))
       BEGIN SELECT RAISE(ABORT, 'dedupe_suggestions.ownerId does not match the contact owner'); END;

-- trigger dedupe_suggestions_owner_fill
CREATE TRIGGER dedupe_suggestions_owner_fill AFTER INSERT ON dedupe_suggestions
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE dedupe_suggestions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactIdA)
          WHERE id = NEW.id;
       END;

-- trigger fts_addresses_ad
CREATE TRIGGER fts_addresses_ad AFTER DELETE ON contact_addresses BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId);
          END;

-- trigger fts_addresses_ai
CREATE TRIGGER fts_addresses_ai AFTER INSERT ON contact_addresses BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (new.contactId);
          END;

-- trigger fts_addresses_au
CREATE TRIGGER fts_addresses_au AFTER UPDATE ON contact_addresses BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId, new.contactId);
          END;

-- trigger fts_education_ad
CREATE TRIGGER fts_education_ad AFTER DELETE ON contact_education BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId);
          END;

-- trigger fts_education_ai
CREATE TRIGGER fts_education_ai AFTER INSERT ON contact_education BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (new.contactId);
          END;

-- trigger fts_education_au
CREATE TRIGGER fts_education_au AFTER UPDATE ON contact_education BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId, new.contactId);
          END;

-- trigger fts_emails_ad
CREATE TRIGGER fts_emails_ad AFTER DELETE ON contact_emails BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId);
          END;

-- trigger fts_emails_ai
CREATE TRIGGER fts_emails_ai AFTER INSERT ON contact_emails BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (new.contactId);
          END;

-- trigger fts_emails_au
CREATE TRIGGER fts_emails_au AFTER UPDATE ON contact_emails BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId, new.contactId);
          END;

-- trigger fts_experience_ad
CREATE TRIGGER fts_experience_ad AFTER DELETE ON contact_experience BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId);
          END;

-- trigger fts_experience_ai
CREATE TRIGGER fts_experience_ai AFTER INSERT ON contact_experience BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (new.contactId);
          END;

-- trigger fts_experience_au
CREATE TRIGGER fts_experience_au AFTER UPDATE ON contact_experience BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId, new.contactId);
          END;

-- trigger fts_interests_ad
CREATE TRIGGER fts_interests_ad AFTER DELETE ON contact_interests BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId);
          END;

-- trigger fts_interests_ai
CREATE TRIGGER fts_interests_ai AFTER INSERT ON contact_interests BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (new.contactId);
          END;

-- trigger fts_interests_au
CREATE TRIGGER fts_interests_au AFTER UPDATE ON contact_interests BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId, new.contactId);
          END;

-- trigger fts_phones_ad
CREATE TRIGGER fts_phones_ad AFTER DELETE ON contact_phones BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId);
          END;

-- trigger fts_phones_ai
CREATE TRIGGER fts_phones_ai AFTER INSERT ON contact_phones BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (new.contactId);
          END;

-- trigger fts_phones_au
CREATE TRIGGER fts_phones_au AFTER UPDATE ON contact_phones BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId, new.contactId);
          END;

-- trigger fts_tags_ad
CREATE TRIGGER fts_tags_ad AFTER DELETE ON contact_tags BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId);
          END;

-- trigger fts_tags_ai
CREATE TRIGGER fts_tags_ai AFTER INSERT ON contact_tags BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (new.contactId);
          END;

-- trigger fts_tags_au
CREATE TRIGGER fts_tags_au AFTER UPDATE ON contact_tags BEGIN
            UPDATE contacts SET searchExpansion = NULL WHERE id IN (old.contactId, new.contactId);
          END;

-- trigger imports_owner_required
CREATE TRIGGER imports_owner_required BEFORE INSERT ON imports
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'imports.ownerId is required'); END;

-- trigger interactions_auto_updated_at
CREATE TRIGGER interactions_auto_updated_at AFTER UPDATE ON interactions
  FOR EACH ROW
  WHEN NEW.updatedAt = OLD.updatedAt OR NEW.updatedAt IS NULL
  BEGIN
    UPDATE interactions SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

-- trigger interactions_fts_ad
CREATE TRIGGER interactions_fts_ad AFTER DELETE ON interactions
      BEGIN
        DELETE FROM interactions_fts WHERE rowid = old.rowid;
      END;

-- trigger interactions_fts_ai
CREATE TRIGGER interactions_fts_ai AFTER INSERT ON interactions
      WHEN new.ownerId IS NOT NULL
      BEGIN
        INSERT INTO interactions_fts(rowid, interactionId, title, content, ownerTok)
        VALUES (new.rowid, new.id, new.title, contrack_note_text(new.content), 'o' || replace(new.ownerId, '-', ''));
      END;

-- trigger interactions_fts_au
CREATE TRIGGER interactions_fts_au AFTER UPDATE OF title, content, ownerId ON interactions
      BEGIN
        DELETE FROM interactions_fts WHERE rowid = old.rowid;
        INSERT INTO interactions_fts(rowid, interactionId, title, content, ownerTok)
        SELECT new.rowid, new.id, new.title, contrack_note_text(new.content), 'o' || replace(new.ownerId, '-', '') WHERE new.ownerId IS NOT NULL;
      END;

-- trigger interactions_owner_check
CREATE TRIGGER interactions_owner_check BEFORE INSERT ON interactions
       WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId))
       BEGIN SELECT RAISE(ABORT, 'interactions.ownerId does not match the contact owner'); END;

-- trigger interactions_owner_fill
CREATE TRIGGER interactions_owner_fill AFTER INSERT ON interactions
       WHEN NEW.ownerId IS NULL
       BEGIN
         UPDATE interactions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
          WHERE id = NEW.id;
       END;

-- trigger interactions_score_dirty_del
CREATE TRIGGER interactions_score_dirty_del AFTER DELETE ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = OLD.contactId AND scoreDirty = 0;
  END;

-- trigger interactions_score_dirty_ins
CREATE TRIGGER interactions_score_dirty_ins AFTER INSERT ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id = NEW.contactId AND scoreDirty = 0;
  END;

-- trigger interactions_score_dirty_upd
CREATE TRIGGER interactions_score_dirty_upd AFTER UPDATE ON interactions
  FOR EACH ROW
  BEGIN
    UPDATE contacts SET scoreDirty = 1
     WHERE id IN (NEW.contactId, OLD.contactId) AND scoreDirty = 0;
  END;

-- trigger lists_owner_required
CREATE TRIGGER lists_owner_required BEFORE INSERT ON lists
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'lists.ownerId is required'); END;

-- trigger map_views_owner_required
CREATE TRIGGER map_views_owner_required BEFORE INSERT ON map_views
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'map_views.ownerId is required'); END;

-- trigger notes_revision_DELETE
CREATE TRIGGER notes_revision_DELETE AFTER DELETE ON interactions
      WHEN old.ownerId IS NOT NULL
      BEGIN
        INSERT INTO notes_revision (ownerId, revision) VALUES (old.ownerId, 1)
          ON CONFLICT(ownerId) DO UPDATE SET revision = notes_revision.revision + 1;
      END;

-- trigger notes_revision_INSERT
CREATE TRIGGER notes_revision_INSERT AFTER INSERT ON interactions
      WHEN new.ownerId IS NOT NULL
      BEGIN
        INSERT INTO notes_revision (ownerId, revision) VALUES (new.ownerId, 1)
          ON CONFLICT(ownerId) DO UPDATE SET revision = notes_revision.revision + 1;
      END;

-- trigger notes_revision_UPDATE
CREATE TRIGGER notes_revision_UPDATE AFTER UPDATE ON interactions
      BEGIN
        INSERT INTO notes_revision (ownerId, revision)
          SELECT new.ownerId, 1 WHERE new.ownerId IS NOT NULL
          ON CONFLICT(ownerId) DO UPDATE SET revision = notes_revision.revision + 1;
        INSERT INTO notes_revision (ownerId, revision)
          SELECT old.ownerId, 1 WHERE old.ownerId IS NOT NULL AND (new.ownerId IS NULL OR old.ownerId != new.ownerId)
          ON CONFLICT(ownerId) DO UPDATE SET revision = notes_revision.revision + 1;
      END;

-- trigger passage_vector_status
CREATE TRIGGER passage_vector_status AFTER UPDATE OF active ON search_passages BEGIN
      UPDATE search_passage_vectors SET active = new.active WHERE passageId = new.id;
    END;

-- trigger passages_delete
CREATE TRIGGER passages_delete AFTER DELETE ON search_passages BEGIN
      DELETE FROM search_passages_fts WHERE rowid = old.rowid;
      DELETE FROM search_passage_vectors WHERE passageId = old.id;
    END;

-- trigger passages_insert
CREATE TRIGGER passages_insert AFTER INSERT ON search_passages BEGIN
      INSERT INTO search_passages_fts(rowid, text, ownerTok)
      VALUES (new.rowid, new.text, 'o' || replace(new.ownerId, '-', ''));
    END;

-- trigger passages_visibility
CREATE TRIGGER passages_visibility AFTER UPDATE OF isGhost, isArchived, deletedAt, canonicalId ON contacts
    WHEN new.isGhost IS NOT old.isGhost OR new.isArchived IS NOT old.isArchived
      OR new.deletedAt IS NOT old.deletedAt OR new.canonicalId IS NOT old.canonicalId BEGIN
      UPDATE search_passages SET active = (new.isGhost = 0 AND COALESCE(new.isArchived, 0) = 0
        AND new.deletedAt IS NULL AND new.canonicalId IS NULL) WHERE contactId = new.id;
    END;

-- trigger score_snapshots_owner_required
CREATE TRIGGER score_snapshots_owner_required BEFORE INSERT ON score_snapshots
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'score_snapshots.ownerId is required'); END;

-- trigger search_embeddings_status
CREATE TRIGGER search_embeddings_status
      AFTER UPDATE OF isGhost, isArchived, deletedAt, canonicalId ON contacts
      WHEN NEW.isGhost IS NOT OLD.isGhost
        OR NEW.isArchived IS NOT OLD.isArchived
        OR NEW.deletedAt IS NOT OLD.deletedAt
        OR NEW.canonicalId IS NOT OLD.canonicalId
    BEGIN
      UPDATE search_embeddings
         SET isGhost = NEW.isGhost,
             isArchived = COALESCE(NEW.isArchived, 0),
             active = (NEW.deletedAt IS NULL AND NEW.canonicalId IS NULL)
       WHERE contactId = NEW.id;
    END;

-- trigger search_history_owner_required
CREATE TRIGGER search_history_owner_required BEFORE INSERT ON search_history
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'search_history.ownerId is required'); END;

-- trigger search_revision_DELETE
CREATE TRIGGER search_revision_DELETE AFTER DELETE ON contacts
      WHEN old.ownerId IS NOT NULL
      BEGIN
        INSERT INTO search_revision (ownerId, revision) VALUES (old.ownerId, 1)
          ON CONFLICT(ownerId) DO UPDATE SET revision = search_revision.revision + 1;
      END;

-- trigger search_revision_INSERT
CREATE TRIGGER search_revision_INSERT AFTER INSERT ON contacts
      WHEN new.ownerId IS NOT NULL
      BEGIN
        INSERT INTO search_revision (ownerId, revision) VALUES (new.ownerId, 1)
          ON CONFLICT(ownerId) DO UPDATE SET revision = search_revision.revision + 1;
      END;

-- trigger search_revision_UPDATE
CREATE TRIGGER search_revision_UPDATE AFTER UPDATE OF id, name, company, role, headline, location, about, industry, preferences, searchExpansion, isGhost, isArchived, canonicalId, deletedAt, ownerId, ownerId ON contacts
      BEGIN
        INSERT INTO search_revision (ownerId, revision)
          SELECT new.ownerId, 1 WHERE new.ownerId IS NOT NULL
          ON CONFLICT(ownerId) DO UPDATE SET revision = search_revision.revision + 1;
        INSERT INTO search_revision (ownerId, revision)
          SELECT old.ownerId, 1 WHERE old.ownerId IS NOT NULL AND (new.ownerId IS NULL OR old.ownerId != new.ownerId)
          ON CONFLICT(ownerId) DO UPDATE SET revision = search_revision.revision + 1;
      END;

-- trigger search_vector_delete
CREATE TRIGGER search_vector_delete AFTER DELETE ON contacts BEGIN
      DELETE FROM search_passages WHERE contactId = old.id;
      DELETE FROM search_passage_state WHERE contactId = old.id;
      DELETE FROM search_embeddings WHERE contactId = old.id;
      DELETE FROM search_index_queue WHERE contactId = old.id;
    END;

-- trigger search_vector_update
CREATE TRIGGER search_vector_update AFTER UPDATE OF name, company, role, headline, location, about, industry, preferences, searchExpansion, ownerId ON contacts BEGIN
      DELETE FROM search_passages WHERE contactId = old.id;
      DELETE FROM search_passage_state WHERE contactId = old.id;
      DELETE FROM search_embeddings WHERE contactId = old.id;
      DELETE FROM search_index_queue WHERE contactId = old.id AND NOT (new.isGhost = 0 AND COALESCE(new.isArchived, 0) = 0
  AND new.canonicalId IS NULL AND new.deletedAt IS NULL);
      INSERT INTO search_index_queue (contactId, ownerId, status, attempts, queuedAt, nextAttemptAt, contactUpdatedAt)
      SELECT new.id, new.ownerId, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, new.updatedAt
      WHERE new.ownerId IS NOT NULL AND new.isGhost = 0 AND COALESCE(new.isArchived, 0) = 0
  AND new.canonicalId IS NULL AND new.deletedAt IS NULL
      ON CONFLICT(contactId) DO UPDATE SET
        status = 'pending',
        ownerId = excluded.ownerId,
        attempts = 0,
        lastError = NULL,
        queuedAt = CURRENT_TIMESTAMP,
        nextAttemptAt = CURRENT_TIMESTAMP,
        contactUpdatedAt = excluded.contactUpdatedAt;
    END;

-- trigger upcoming_events_owner_required
CREATE TRIGGER upcoming_events_owner_required BEFORE INSERT ON upcoming_events
       WHEN NEW.ownerId IS NULL
       BEGIN SELECT RAISE(ABORT, 'upcoming_events.ownerId is required'); END;
