import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  primaryKey,
  unique,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Identity. Every owned row carries `ownerId` (see OWNERSHIP below), and `role`
// separates admins from members.

/**
 * users: one row per account. `email` and `username` are stored lowercased and
 * are each unique; sign-in accepts either. `passwordHash` is a self-describing
 * scrypt string (server/services/passwords.ts), so the cost can rise without
 * invalidating existing passwords.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  /** Lowercased. Unique. Accepted as a sign-in identifier. */
  email: text("email").notNull().unique(),
  /** Lowercased. Unique. Accepted as a sign-in identifier. */
  username: text("username").notNull().unique(),
  /** Free-form name for display; falls back to username when empty. */
  displayName: text("displayName"),
  /** `scrypt$N$r$p$salt$hash` — parameters travel with the hash. */
  passwordHash: text("passwordHash").notNull(),
  /** 'admin' | 'member'. The first account created is always 'admin'. */
  role: text("role").notNull().default("member"),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  lastLoginAt: text("lastLoginAt"),
  /** 'active' | 'disabled'. Disabling ends the account's live sessions. */
  status: text("status").notNull().default("active"),
  /**
   * 'password' for an account somebody signs in to, 'none' for the local owner,
   * which holds this device's data while auth is off. Its hash is `none$`,
   * which cannot parse, so nothing can sign in as it. Securing an instance
   * converts this row rather than adding one, which is how the data comes
   * along.
   */
  credentialState: text("credentialState").notNull().default("password"),
  /** Set by an admin password reset. Requires the user to change password on next login. */
  mustChangePassword: integer("mustChangePassword").notNull().default(0),
  passwordChangedAt: text("passwordChangedAt"),
  disabledAt: text("disabledAt"),
  /** The admin who invited or created this account. */
  createdBy: text("createdBy").references((): AnySQLiteColumn => users.id, {
    onDelete: "set null",
  }),
  avatarUrl: text("avatarUrl"),
});

/**
 * api_tokens: per-user machine credentials, `ctk_<43 base64url chars>`, shown
 * once at creation. Only the SHA-256 reaches the database, so a leaked backup
 * does not hand over working tokens. `tokenPrefix` is the first 12 characters,
 * which a list can show without it being a credential.
 */
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** What the person called it, so two tokens can be told apart. */
  name: text("name").notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  tokenPrefix: text("tokenPrefix").notNull(),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  /** Stamped at most once an hour, the same way sessions.lastSeenAt is. */
  lastUsedAt: text("lastUsedAt"),
  expiresAt: text("expiresAt"),
  revokedAt: text("revokedAt"),
  /** 1 for a token that may read and call the read-only MCP tools only. */
  readOnly: integer("readOnly").notNull().default(0),
  /** `personal`, or `oauth` for an app a person approved (oauth_* tables). */
  kind: text("kind").notNull().default("personal"),
  /** The oauth_clients id of an `oauth` grant. */
  clientId: text("clientId"),
});

/**
 * oauth_clients — the apps that may ask for an OAuth grant. A registered
 * client's id is `ctc_…`. A client with a metadata document uses its URL.
 */
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  name: text("name").notNull(),
  /** JSON array of the exact redirect URIs. */
  redirectUris: text("redirectUris").notNull(),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  lastUsedAt: text("lastUsedAt"),
  /** A metadata document is read again after this. */
  staleAt: text("staleAt"),
});

/** oauth_requests — one sign-in from the authorize link to the code. */
export const oauthRequests = sqliteTable(
  "oauth_requests",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    redirectUri: text("redirectUri").notNull(),
    state: text("state"),
    codeChallenge: text("codeChallenge").notNull(),
    wantsWrite: integer("wantsWrite").notNull(),
    ip: text("ip"),
    userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
    readOnly: integer("readOnly"),
    codeHash: text("codeHash").unique(),
    grantId: text("grantId"),
    usedAt: text("usedAt"),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: text("expiresAt").notNull(),
  },
  (table) => [index("idx_oauth_requests_expires").on(table.expiresAt)],
);

/** oauth_tokens — a grant's access and refresh tokens, as SHA-256. */
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    tokenHash: text("tokenHash").primaryKey(),
    grantId: text("grantId")
      .notNull()
      .references(() => apiTokens.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    expiresAt: text("expiresAt").notNull(),
    /** When a refresh token was rotated. */
    usedAt: text("usedAt"),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_oauth_tokens_grant").on(table.grantId)],
);

/** invitations — a signup link an admin hands out. */
export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  /** Optional: an open invite has no address attached. */
  email: text("email"),
  role: text("role").notNull().default("member"),
  tokenHash: text("tokenHash").notNull().unique(),
  invitedBy: text("invitedBy")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  expiresAt: text("expiresAt").notNull(),
  acceptedAt: text("acceptedAt"),
  acceptedBy: text("acceptedBy").references(() => users.id, {
    onDelete: "set null",
  }),
  revokedAt: text("revokedAt"),
});

/**
 * user_settings: per-account preferences. Provider keys and capability
 * assignments stay instance-wide in app_settings, because they belong to the
 * operator.
 */
export const userSettings = sqliteTable(
  "user_settings",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updatedAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.key] }),
  }),
);

/**
 * app_settings: instance-wide settings, one JSON value per key: provider keys,
 * custom OpenAI-compatible endpoints, capability assignments, cached model
 * lists (server/services/settingsService.ts) and `search.vectorScale`.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updatedAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * audit_log: who did what to whom. `actorUserId` is SET NULL, not CASCADE,
 * because deleting an account must not erase the record of what it did.
 */
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actorUserId").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  targetType: text("targetType"),
  targetId: text("targetId"),
  /** JSON. Never a password, a token, or a contact's contents. */
  details: text("details"),
  ip: text("ip"),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * sessions: server-side browser sessions. `id` is the SHA-256 of the cookie
 * secret, so a leaked database or backup does not hand over live sessions.
 * Server-side rather than a JWT, because "sign out everywhere" has to end the
 * session.
 */
export const sessions = sqliteTable("sessions", {
  /** SHA-256 hex of the cookie secret. */
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  /** ISO timestamp; expired rows are rejected on use and swept on boot. */
  expiresAt: text("expiresAt").notNull(),
  lastSeenAt: text("lastSeenAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  /** Truncated User-Agent, so the sessions list can say which device. */
  userAgent: text("userAgent"),
  /** Method used to establish the session: 'password' | 'passkey' | 'email-link' | null. */
  method: text("method"),
});

/** passkeys: WebAuthn discoverable credentials. */
export const passkeys = sqliteTable("passkeys", {
  /** Credential ID, base64url encoded. */
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** COSE public key bytes. */
  publicKey: blob("publicKey", { mode: "buffer" }).notNull(),
  counter: integer("counter").notNull().default(0),
  /** JSON array of transport strings, or null. */
  transports: text("transports"),
  deviceType: text("deviceType").notNull().default("singleDevice"),
  backedUp: integer("backedUp").notNull().default(0),
  aaguid: text("aaguid"),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  lastUsedAt: text("lastUsedAt"),
});

/** auth_challenges: short-lived WebAuthn ceremony challenges. */
export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  /** 'register' | 'login'. */
  kind: text("kind").notNull(),
  userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
  challenge: text("challenge").notNull(),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  expiresAt: text("expiresAt").notNull(),
});

/** auth_links: one-time tokens for password reset and magic-link sign-in. */
export const authLinks = sqliteTable("auth_links", {
  id: text("id").primaryKey(),
  /** 'reset' | 'magic'. */
  kind: text("kind").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("tokenHash").notNull().unique(),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  expiresAt: text("expiresAt").notNull(),
  usedAt: text("usedAt"),
  requestIp: text("requestIp"),
});

// Core tables

/**
 * contacts: one row per person. Multi-value fields (emails, phones and the
 * rest) live in child tables keyed by contactId.
 */
export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  firstName: text("firstName"),
  lastName: text("lastName"),
  headline: text("headline"),
  role: text("role"),
  company: text("company"),
  location: text("location"),
  birthday: text("birthday"),
  preferences: text("preferences"),
  avatarUrl: text("avatarUrl"),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").default(sql`(CURRENT_TIMESTAMP)`),
  cadenceDays: integer("cadenceDays").default(90),
  lastContactedAt: text("lastContactedAt"),
  nextFollowUpAt: text("nextFollowUpAt"),
  themeColor: text("themeColor").default("brand"),
  about: text("about"),
  pronouns: text("pronouns"),
  industry: text("industry"),
  website: text("website"),
  lat: real("lat"),
  lng: real("lng"),
  /**
   * Who placed the pin. `'geocoder'` when the address was read into `lat` and
   * `lng`, `'manual'` when a person dragged the pin, NULL before either. The
   * geocoder never overwrites a `'manual'` row.
   */
  geoSource: text("geoSource"),
  aiBriefing: text("aiBriefing"),
  aiBackground: text("aiBackground"),
  /**
   * The research record: every enrichment, what it added, the facts it
   * reported and the pages it cited. JSON in the shape of
   * shared/researchRecord.ts, written only by the enrichment merge.
   */
  aiResearch: text("aiResearch"),
  aiSummary: text("aiSummary"),
  aiHydratedAt: text("aiHydratedAt"),
  aiBriefingAt: text("aiBriefingAt"),
  isGhost: integer("isGhost").default(0),
  isArchived: integer("isArchived").default(0),
  relationshipScore: integer("relationshipScore").default(50),
  /**
   * 1 when the relationship score must be computed again. A new contact
   * starts dirty, and the `contacts_score_dirty` trigger marks an edited one.
   * Writing it is not an edit (`SCORE_COLUMNS` in server/db/helpers.ts).
   */
  scoreDirty: integer("scoreDirty").notNull().default(1),
  /**
   * A person chose to keep up with this contact. Only a tracked contact is
   * scored, appears on Pulse, or is tinted on the map. Off for everyone
   * until a person says so.
   */
  isTracked: integer("isTracked").notNull().default(0),
  /**
   * When `isTracked` last turned on, written by the `contacts_track_stamp_*`
   * triggers (server/db/migrations/0001_baseline.ts) and cleared when it
   * turns off. The clock for a tracked contact with no interaction yet.
   */
  trackedAt: text("trackedAt"),
  /**
   * When `isArchived` last turned on, written by the
   * `contacts_archive_stamp_*` triggers (migration 0007) and cleared when it
   * turns off. The date on the Archived page.
   */
  archivedAt: text("archivedAt"),
  /**
   * Extra search words for this contact, indexed in `contacts_fts` and read by
   * vector search. A derived cache that nothing writes; the triggers and the
   * index queue clear it when the text under it changes.
   */
  searchExpansion: text("searchExpansion"),
  // Dedupe infrastructure
  canonicalId: text("canonicalId"), // Soft merge: points to primary contact's id. NULL = active contact.
  deletedAt: text("deletedAt"), // Trash: soft-delete timestamp. NULL = not deleted. Purged after TRASH_RETENTION_DAYS.
  phoneticHash: text("phoneticHash"), // Double Metaphone encoding for phonetic blocking.
  /** Owning account. NULL never survives boot (see OWNERSHIP below). */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

// OWNERSHIP
//
// `ownerId` is on every table in `OWNED_TABLES` (server/db.ts): contacts,
// lists, interactions, action_items, dedupe_suggestions, dedupe_exclusions,
// dedupe_merge_log, ai_invocations and the tables listed after them.
//
// THE INVARIANT: after boot, `ownerId` is never NULL. SQLite cannot add a NOT
// NULL column to an existing table, so triggers give the guarantee.
// `<table>_owner_required` refuses a row with no owner on the tables with no
// parent contact. `<table>_owner_fill` copies it from the parent contact, and
// `<table>_owner_check` refuses a child row whose owner disagrees with its
// contact, which makes a cross-owner dedupe pair impossible.
//
// The child tables keep a denormalized copy of the owner so a covering index on
// `(ownerId, date)` answers a scoped timeline without reading `contacts`.
// `contacts_owner_propagate` pushes an owner change down to them. It cannot
// update the two vec0 tables, because sqlite-vec refuses an UPDATE of a
// partition key.
//
// dedupe_merge_log has no foreign key to contacts, because its snapshots of
// hard-deleted contacts must outlive them. Its owner is copied from the
// surviving contact at write time.
//
// THE LOCAL OWNER makes auth-off mode work. Every instance has it from boot:
// username `local`, `credentialState = 'none'`, a hash that cannot parse. With
// auth off it is the principal for a request with no credential, so every row
// has a real owner (server/db/owners.ts). Securing the instance converts that
// row in place, keeping its id.
//
// ON DELETE RESTRICT, not CASCADE: a `DELETE FROM users` that would orphan
// owned rows fails loudly instead of destroying every contact. Account deletion
// removes the data first. `sessions` still cascades, because a session without
// its account means nothing.

// Normalized child tables

/**
 * contact_emails: emails with label, primary flag and the source that added
 * each one.
 */
export const contactEmails = sqliteTable("contact_emails", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  label: text("label").default("personal"),
  isPrimary: integer("isPrimary").default(0),
  sortOrder: integer("sortOrder").default(0),
  source: text("source"),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
});

/** contact_phones: phone numbers with label and source. */
export const contactPhones = sqliteTable("contact_phones", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  label: text("label").default("mobile"),
  isPrimary: integer("isPrimary").default(0),
  sortOrder: integer("sortOrder").default(0),
  source: text("source"),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
});

/** contact_addresses: physical addresses. */
export const contactAddresses = sqliteTable(
  "contact_addresses",
  {
    id: text("id").primaryKey(),
    contactId: text("contactId")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    label: text("label").default("home"),
    isPrimary: integer("isPrimary").default(0),
    sortOrder: integer("sortOrder").default(0),
    source: text("source"),
    addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    unq: unique().on(t.contactId, t.address),
  }),
);

/**
 * contact_social_links: profile URLs. `platform` picks the icon and dedupes
 * links across imports.
 */
export const contactSocialLinks = sqliteTable("contact_social_links", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  url: text("url").notNull(),
  handle: text("handle"),
  source: text("source"),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_education: education history with separate dates and field of study.
 */
export const contactEducation = sqliteTable("contact_education", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  school: text("school").notNull(),
  degree: text("degree"),
  fieldOfStudy: text("fieldOfStudy"),
  startDate: text("startDate"),
  endDate: text("endDate"),
  description: text("description"),
  source: text("source"),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_experience: work history with `isCurrent`, separate dates and a
 * location per entry.
 */
export const contactExperience = sqliteTable("contact_experience", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  company: text("company").notNull(),
  role: text("role"),
  startDate: text("startDate"),
  endDate: text("endDate"),
  isCurrent: integer("isCurrent").default(0),
  description: text("description"),
  location: text("location"),
  source: text("source"),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_sources: one row per import of a contact: the platform, the external
 * profile id or URL, and the original connection date (LinkedIn "Connected
 * On").
 */
export const contactSources = sqliteTable("contact_sources", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  externalId: text("externalId"),
  connectedOn: text("connectedOn"),
  importedAt: text("importedAt").default(sql`(CURRENT_TIMESTAMP)`),
  rawData: text("rawData"),
});

/** Rebuildable search evidence. Offsets refer to the exact source text. */
export const searchPassages = sqliteTable(
  "search_passages",
  {
    id: text("id").primaryKey(),
    contactId: text("contactId")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    ownerId: text("ownerId").notNull(),
    field: text("field").notNull(),
    sourceId: text("sourceId").notNull(),
    sourceHash: text("sourceHash").notNull(),
    active: integer("active").notNull().default(1),
    context: text("context").notNull(),
    startOffset: integer("startOffset").notNull(),
    endOffset: integer("endOffset").notNull(),
    text: text("text").notNull(),
  },
  (table) => [
    index("idx_search_passages_contact").on(table.contactId),
    index("idx_search_passages_owner").on(table.ownerId),
  ],
);

/** A transaction writes this marker only after every passage vector succeeds. */
export const searchPassageState = sqliteTable(
  "search_passage_state",
  {
    contactId: text("contactId")
      .primaryKey()
      .references(() => contacts.id, { onDelete: "cascade" }),
    ownerId: text("ownerId").notNull(),
    representationVersion: integer("representationVersion").notNull(),
    fingerprint: text("fingerprint").notNull(),
    signature: text("signature").notNull(),
    indexedAt: text("indexedAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_search_passage_state_owner").on(table.ownerId)],
);

/** contact_tags: free-form tags. */
export const contactTags = sqliteTable("contact_tags", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
});

/** contact_interests: hobbies and interests, kept apart from tags. */
export const contactInterests = sqliteTable(
  "contact_interests",
  {
    id: text("id").primaryKey(),
    contactId: text("contactId")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    interest: text("interest").notNull(),
    isAiGenerated: integer("isAiGenerated", { mode: "boolean" }).default(false),
    addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    unq: unique().on(t.contactId, t.interest),
  }),
);

/**
 * contact_attributes: named facts that fit no other field, such as { name:
 * "Investment Philosophy", value: "Focuses on early stage AI..." }.
 */
export const contactAttributes = sqliteTable(
  "contact_attributes",
  {
    id: text("id").primaryKey(),
    contactId: text("contactId")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull(),
    addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    unq: unique().on(t.contactId, t.name),
  }),
);

// Interactions (timeline)

/** interactions: timeline entries for each contact. */
export const interactions = sqliteTable("interactions", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  date: text("date").default(sql`(CURRENT_TIMESTAMP)`),
  duration: text("duration"),
  fileUrl: text("fileUrl"),
  fileName: text("fileName"),
  fileType: text("fileType"),
  source: text("source"),
  mentions: text("mentions"),
  updatedAt: text("updatedAt").default(sql`(CURRENT_TIMESTAMP)`),
  /**
   * Owning account, denormalized from the parent contact. Triggers fill it and
   * refuse a value that disagrees. See the OWNERSHIP note above.
   */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

/** interaction_mentions: the contacts an interaction mentions. */
export const interactionMentions = sqliteTable(
  "interaction_mentions",
  {
    interactionId: text("interactionId")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),
    contactId: text("contactId")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.interactionId, t.contactId] }),
  }),
);

// Deduplication

/**
 * dedupe_suggestions: pairs of contacts that may be duplicates. Status runs
 * pending → merged / dismissed / auto_merged.
 */
export const dedupeSuggestions = sqliteTable(
  "dedupe_suggestions",
  {
    id: text("id").primaryKey(),
    contactIdA: text("contactIdA")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    contactIdB: text("contactIdB")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    matchType: text("matchType").notNull(), // 'email' | 'phone' | 'name' | 'nickname' | 'embedding' | 'ai'
    confidence: real("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    matchedField: text("matchedField"),
    status: text("status").notNull().default("pending"), // 'pending' | 'merged' | 'dismissed' | 'auto_merged'
    createdAt: text("createdAt").default(sql`(CURRENT_TIMESTAMP)`),
    reviewedAt: text("reviewedAt"),
    reviewedBy: text("reviewedBy"), // 'user' | 'auto'
    /**
     * Owning account, denormalized from contactIdA. A trigger checks it
     * against both contacts, so a cross-owner suggestion cannot be written.
     */
    ownerId: text("ownerId").references(() => users.id, {
      onDelete: "restrict",
    }),
    /**
     * Why a person should look twice before merging, such as "First names
     * differ: Ada and Ben". Null when nothing argues against the match.
     */
    caveat: text("caveat"),
  },
  (t) => ({
    unq: unique().on(t.contactIdA, t.contactIdB),
    // 0005: the UNIQUE index finds a pair by contactIdA, this one by contactIdB.
    byContactB: index("idx_dedupe_sugg_contact_b").on(t.contactIdB),
  }),
);

/** dedupe_exclusions: pairs a person dismissed, never suggested again. */
export const dedupeExclusions = sqliteTable(
  "dedupe_exclusions",
  {
    contactIdA: text("contactIdA")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    contactIdB: text("contactIdB")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: text("createdAt").default(sql`(CURRENT_TIMESTAMP)`),
    /** Owning account, denormalized from contactIdA. */
    ownerId: text("ownerId").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.contactIdA, t.contactIdB] }),
  }),
);

/**
 * dedupe_merge_log: every merge, hard or soft, with snapshots, so a soft merge
 * can be undone.
 */
export const dedupeMergeLog = sqliteTable("dedupe_merge_log", {
  id: text("id").primaryKey(),
  primaryId: text("primaryId").notNull(),
  duplicateId: text("duplicateId").notNull(),
  mergedBy: text("mergedBy").notNull(), // 'user' | 'auto'
  mergeType: text("mergeType").notNull(), // 'soft' | 'hard'
  confidence: real("confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  mergedAt: text("mergedAt").default(sql`(CURRENT_TIMESTAMP)`),
  undoneAt: text("undoneAt"),
  duplicateSnapshot: text("duplicateSnapshot"), // JSON blob for hard deletes
  /**
   * Owning account. Copied, because there is no foreign key to join through:
   * the snapshots outlive the contacts they describe.
   */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

/**
 * dedupe_embedding_meta: when each contact's dedupe vector was computed. A
 * contact whose `updatedAt` is newer than `embeddedAt` is embedded again.
 */
export const dedupeEmbeddingMeta = sqliteTable("dedupe_embedding_meta", {
  contactId: text("contactId").primaryKey(),
  embeddedAt: text("embeddedAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// Action items

/**
 * action_items: follow-up tasks, several per contact. Triggers keep
 * `contacts.nextFollowUpAt` in sync as a denormalized cache.
 */
export const actionItems = sqliteTable("action_items", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  interactionId: text("interactionId").references(() => interactions.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  dueAt: text("dueAt").notNull(),
  completedAt: text("completedAt"),
  createdAt: text("createdAt").default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updatedAt").default(sql`(CURRENT_TIMESTAMP)`),
  /** Owning account, denormalized from the parent contact. */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

// Lists

/** lists: named contact groups with an icon and a sort order. */
export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("star"),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: text("createdAt").default(sql`(CURRENT_TIMESTAMP)`),
  /** Owning account — see the OWNERSHIP note above. */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

/** list_members: which contacts are in which list, each at most once. */
export const listMembers = sqliteTable(
  "list_members",
  {
    listId: text("listId")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    contactId: text("contactId")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.listId, t.contactId] }),
  }),
);

// AI invocation log

/**
 * ai_invocations: every AI call, fresh or cached, for the AI usage page. No
 * foreign keys: a row names its contact or query in `description` only. Rows
 * older than 30 days are deleted.
 */
export const aiInvocations = sqliteTable("ai_invocations", {
  id: text("id").primaryKey(),
  /** Fixed vocabulary: briefing, rerank, mentions, synthesis, parse, searchExpansion, dailyInsight, emlSummary, bulkParse, aiSearchGrounding, aiSearchNoSearch, aiSearchExtraction, aiSearchReading */
  operation: text("operation").notNull(),
  /** Model ID that served this request (null for cached responses) */
  model: text("model"),
  /** Total token count — input + output combined (null for cached responses) */
  tokenCount: integer("tokenCount"),
  /** Wall-clock latency in milliseconds (<1 for cache hits) */
  latencyMs: integer("latencyMs").notNull(),
  /** Whether this response was served from aiCache (0|1 boolean) */
  cached: integer("cached").notNull().default(0),
  /** Contextual one-liner, e.g. "Catch-Me-Up for Julian Rivera" */
  description: text("description"),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(datetime('now'))`),
  /** Owning account — see the OWNERSHIP note above. Standalone table, no FK. */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

/**
 * search_index_queue: contacts waiting for their search vectors, durable across
 * restarts. An edit removes the old vectors and queues the contact. Local
 * models drain it in the background with retries. A provider-backed refresh
 * waits until a person starts it.
 */
export const searchIndexQueue = sqliteTable("search_index_queue", {
  contactId: text("contactId").primaryKey(),
  ownerId: text("ownerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("lastError"),
  queuedAt: text("queuedAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  nextAttemptAt: text("nextAttemptAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  contactUpdatedAt: text("contactUpdatedAt"),
});

/**
 * search_revision — a counter per owner that a trigger raises on every
 * change to a searched contact column. The Ask cache keys on it.
 */
export const searchRevision = sqliteTable("search_revision", {
  ownerId: text("ownerId").primaryKey(),
  revision: integer("revision").notNull(),
});

/**
 * notes_revision — the same counter for notes, raised on every insert, edit
 * and delete of an interaction.
 */
export const notesRevision = sqliteTable("notes_revision", {
  ownerId: text("ownerId").primaryKey(),
  revision: integer("revision").notNull(),
});

/**
 * imports — one durable record per bulk import, so a browser that lost its
 * connection can reconnect to it, and a second request with the same id is
 * a question rather than a second import.
 */
export const imports = sqliteTable(
  "imports",
  {
    id: text("id").primaryKey(),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("running"),
    phase: text("phase"),
    message: text("message"),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    imported: integer("imported").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    autoMerged: integer("autoMerged"),
    needsReview: integer("needsReview"),
    newUnique: integer("newUnique"),
    error: text("error"),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updatedAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    completedAt: text("completedAt"),
  },
  (table) => [
    index("idx_imports_owner_created").on(table.ownerId, table.createdAt),
  ],
);

/**
 * import_rows — one row per input row of an import. It keeps the row's
 * payload only while the row is failed, so a retry can run it again.
 */
export const importRows = sqliteTable(
  "import_rows",
  {
    importId: text("importId")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowIndex: integer("rowIndex").notNull(),
    status: text("status").notNull(),
    contactId: text("contactId"),
    name: text("name"),
    error: text("error"),
    payload: text("payload"),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.rowIndex] }),
    index("idx_import_rows_status").on(table.importId, table.status),
  ],
);

/**
 * score_snapshots: weekly relationship scores, keyed by (contactId, weekStart)
 * and kept for 26 weeks.
 */
export const scoreSnapshots = sqliteTable(
  "score_snapshots",
  {
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    contactId: text("contactId")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    weekStart: text("weekStart").notNull(),
    score: real("score").notNull(),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.contactId, t.weekStart] }),
  }),
);

/**
 * search_history: one row per distinct question per owner and mode, with its
 * snapshot, pinned state, run count and last run.
 */
export const searchHistory = sqliteTable(
  "search_history",
  {
    id: text("id").primaryKey(),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    mode: text("mode").notNull(),
    query: text("query").notNull(),
    normalizedQuery: text("normalizedQuery").notNull(),
    resultCount: integer("resultCount"),
    resultIds: text("resultIds"),
    fallback: integer("fallback").notNull().default(0),
    pinned: integer("pinned").notNull().default(0),
    runCount: integer("runCount").notNull().default(1),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
    lastRunAt: text("lastRunAt")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (table) => [
    unique().on(table.ownerId, table.mode, table.normalizedQuery),
    index("idx_search_history_owner_last").on(
      table.ownerId,
      table.lastRunAt,
      table.id,
    ),
    index("idx_search_history_owner_mode_last").on(
      table.ownerId,
      table.mode,
      table.lastRunAt,
      table.id,
    ),
    index("idx_search_history_owner_pinned").on(
      table.ownerId,
      table.pinned,
      table.lastRunAt,
      table.id,
    ),
  ],
);

export const connectors = sqliteTable(
  "connectors",
  {
    id: text("id").primaryKey(),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    config: text("config").notNull().default("{}"),
    secret: text("secret"),
    cursor: text("cursor"),
    intervalMinutes: integer("intervalMinutes").notNull().default(30),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: text("nextRunAt"),
    lastRunAt: text("lastRunAt"),
    lastError: text("lastError"),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updatedAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_connectors_owner").on(table.ownerId, table.createdAt),
    index("idx_connectors_due").on(table.status, table.nextRunAt),
  ],
);

export const connectorRuns = sqliteTable(
  "connector_runs",
  {
    id: text("id").primaryKey(),
    connectorId: text("connectorId")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    startedAt: text("startedAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    finishedAt: text("finishedAt"),
    stats: text("stats"),
    error: text("error"),
  },
  (table) => [
    index("idx_connector_runs_conn").on(table.connectorId, table.startedAt),
  ],
);

export const connectorLinks = sqliteTable(
  "connector_links",
  {
    connectorId: text("connectorId")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    externalId: text("externalId").notNull(),
    localId: text("localId"),
    seenCount: integer("seenCount").notNull().default(1),
    lastSeenAt: text("lastSeenAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    ignoredAt: text("ignoredAt"),
    /** A correspondent's name, as its mail or meeting gave it. */
    displayName: text("displayName"),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.connectorId, table.kind, table.externalId],
    }),
    idxLocal: index("idx_connector_links_local").on(table.localId),
  }),
);

export const upcomingEvents = sqliteTable(
  "upcoming_events",
  {
    connectorId: text("connectorId")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    externalId: text("externalId").notNull(),
    title: text("title").notNull(),
    startsAt: text("startsAt").notNull(),
    endsAt: text("endsAt").notNull(),
    participants: text("participants").notNull(),
    contactIds: text("contactIds").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.connectorId, table.externalId] }),
    idxOwnerStart: index("idx_upcoming_owner_start").on(
      table.ownerId,
      table.startsAt,
    ),
  }),
);

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  ownerId: text("ownerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  codeVerifier: text("codeVerifier").notNull(),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const mapViews = sqliteTable(
  "map_views",
  {
    id: text("id").primaryKey(),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    query: text("query").notNull().default(""),
    layer: text("layer").notNull().default("pins"),
    bounds: text("bounds").notNull(),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updatedAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    idxOwnerSortName: index("idx_map_views_owner").on(
      table.ownerId,
      table.sortOrder,
      table.name,
    ),
  }),
);

/**
 * geocode_cache — what the geocoder answered for each normalized location,
 * found or not, shared by every account. A failure is asked again after
 * FAILURE_TTL_DAYS (server/services/geocoding/cache.ts).
 */
export const geocodeCache = sqliteTable("geocode_cache", {
  key: text("key").primaryKey(),
  lat: real("lat"),
  lng: real("lng"),
  provider: text("provider").notNull(),
  success: integer("success").notNull().default(0),
  createdAt: text("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  /** The place the answer names (0003_map_pins). */
  displayName: text("displayName"),
});

// The migration ledger

/**
 * schema_migrations: one row per applied migration (`kind = 'migration'`, such
 * as `0001_baseline`), and one per derived structure with the version it is
 * built at (`kind = 'index'`, such as `contacts_fts`). Written by
 * server/db/runner.ts and server/db/indexes.ts. Not here on purpose:
 * `__drizzle_migrations`, the FTS5 and vec0 virtual tables, and their shadow
 * tables.
 */
export const schemaMigrations = sqliteTable("schema_migrations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  version: integer("version").notNull().default(1),
  appliedAt: text("appliedAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// Events and jobs (migration 0002_events_and_jobs)

/**
 * events — what a write changed, recorded in the write's own transaction by
 * `recordEvent` (server/events/record.ts). Subscribers read it in `id` order
 * after the commit. The payload is JSON in the schema of its type
 * (shared/contracts/events.ts), and it carries ids and field names only.
 * Maintenance removes rows older than 30 days that every cursor has passed.
 */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    subjectType: text("subjectType").notNull(),
    subjectId: text("subjectId").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_events_owner").on(table.ownerId, table.id)],
);

/**
 * event_cursors — one row per subscriber: the last event it handled, and how
 * many times in a row it has failed on the next one.
 */
export const eventCursors = sqliteTable("event_cursors", {
  subscriber: text("subscriber").primaryKey(),
  lastEventId: integer("lastEventId").notNull().default(0),
  failures: integer("failures").notNull().default(0),
});

/**
 * jobs — durable background work (server/jobs/runner.ts). `ownerId` is null
 * for the instance's own work, such as a backup, so the table is not in
 * OWNED_TABLES. `dedupeKey` allows one queued or running row per key, which
 * is how a recurring job keeps exactly one next run.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    ownerId: text("ownerId").references(() => users.id, {
      onDelete: "restrict",
    }),
    payload: text("payload").notNull().default("{}"),
    status: text("status").notNull().default("queued"),
    runAt: text("runAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(3),
    lastError: text("lastError"),
    progress: text("progress"),
    dedupeKey: text("dedupeKey"),
    createdAt: text("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    startedAt: text("startedAt"),
    finishedAt: text("finishedAt"),
  },
  (table) => [index("idx_jobs_due").on(table.status, table.runAt)],
);
