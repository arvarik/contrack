import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  unique,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

// =============================================================================
// Identity
// =============================================================================
// Contrack is single-account today: one `users` row, created through the
// first-run setup screen. The tables are shaped for more than that on purpose,
// because the thing that makes multi-tenancy expensive is not the login — it
// is retrofitting ownership onto data that was written without it. Carrying
// `ownerId` from the start means that project becomes "scope the queries"
// rather than "scope the queries AND migrate live data".
//
// What is deliberately NOT here: any endpoint that creates a second user.
// Two users today would share every contact, because no query filters by
// owner yet — an actively misleading feature. `role` exists so the column is
// already populated when admin/member starts to mean something.
// =============================================================================

/**
 * users — Account records. Exactly one row in the current single-user model.
 *
 * `email` and `username` are both stored lowercased and are independently
 * unique; sign-in accepts either. `passwordHash` is a self-describing scrypt
 * string (see server/services/passwords.ts) so the cost parameters can be
 * raised later without invalidating existing passwords.
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
   * 'password' for an account somebody signs in to, 'none' for the local
   * owner. The local owner holds this device's data while auth is off; its
   * hash is `none$`, which cannot parse, so nothing can sign in as it.
   * Securing an instance converts this row rather than adding one, which is
   * how the data comes along.
   */
  credentialState: text("credentialState").notNull().default("password"),
  /** Set by an admin password reset. Phase 3 acts on it. */
  mustChangePassword: integer("mustChangePassword").notNull().default(0),
  passwordChangedAt: text("passwordChangedAt"),
  disabledAt: text("disabledAt"),
  /** The admin who invited or created this account. */
  createdBy: text("createdBy").references((): AnySQLiteColumn => users.id, {
    onDelete: "set null",
  }),
});

/**
 * api_tokens — per-user machine credentials.
 *
 * `ctk_<43 base64url chars>`, shown once at creation. Only the SHA-256 reaches
 * the database, so a leaked backup does not hand over working tokens.
 * `tokenPrefix` is the first 12 characters, which is what a list can show
 * without being a credential itself.
 *
 * Created in Phase 1 so attachPrincipal can resolve one. The endpoints that
 * mint them are Phase 3.
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
});

/** invitations — a signup link an admin hands out. Phase 3 uses these. */
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
 * user_settings — per-account preferences.
 *
 * The counterpart to app_settings, which stays instance-wide: provider keys
 * and capability assignments belong to the operator, not to each person.
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
 * audit_log — who did what to whom.
 *
 * `actorUserId` is SET NULL rather than CASCADE: deleting an account must not
 * erase the record of what it did, which is the entire point of an audit log.
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
 * sessions — Server-side browser sessions.
 *
 * `id` is the SHA-256 of the secret held in the client's cookie, never the
 * secret itself: a leaked database (or a stray backup, of which this app keeps
 * seven) does not hand over live sessions. Lookup is still a primary-key hit.
 *
 * Server-side rather than a stateless JWT because revocation is the feature
 * that matters here — "sign out everywhere" has to actually end the session,
 * and a self-hosted app cannot lean on short expiries to paper over that.
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
});

// =============================================================================
// Core Tables
// =============================================================================

/**
 * contacts — Primary entity table. Stores demographic, geospatial, and CRM
 * metadata. All multi-value fields (emails, phones, etc.) are normalized into
 * dedicated child tables linked by contactId.
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
  aiBriefing: text("aiBriefing"),
  aiBackground: text("aiBackground"),
  aiSummary: text("aiSummary"),
  aiHydratedAt: text("aiHydratedAt"),
  aiBriefingAt: text("aiBriefingAt"),
  isGhost: integer("isGhost").default(0),
  isArchived: integer("isArchived").default(0),
  relationshipScore: integer("relationshipScore").default(50),
  // Dedupe infrastructure (Phase 1)
  canonicalId: text("canonicalId"), // Soft merge: points to primary contact's id. NULL = active contact.
  deletedAt: text("deletedAt"), // Trash: soft-delete timestamp. NULL = not deleted. Purged after TRASH_RETENTION_DAYS.
  phoneticHash: text("phoneticHash"), // Double Metaphone encoding for phonetic blocking.
  /**
   * Owning account. See the OWNERSHIP note below — NULL means "belongs to
   * whoever owns this instance", which is every row until an account exists.
   */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

// =============================================================================
// OWNERSHIP
// =============================================================================
// Since Phase 1 of the 2.0 work, `ownerId` appears on eight tables: contacts,
// lists, interactions, action_items, dedupe_suggestions, dedupe_exclusions,
// dedupe_merge_log and ai_invocations.
//
// THE INVARIANT: after boot, `ownerId` is never NULL. SQLite cannot add a NOT
// NULL column to an existing table, so triggers give the same guarantee.
// `<table>_owner_required` aborts an insert with no owner on the four tables
// that have no parent contact. `<table>_owner_fill` fills it from the parent
// on the four that do, and `<table>_owner_check` aborts a child row whose
// owner disagrees with its contact — which is what makes a cross-owner dedupe
// pair impossible rather than merely unlikely.
//
// The four child tables carry a denormalized copy of their contact's owner.
// That is redundant by design: a covering index on `(ownerId, date)` answers a
// scoped timeline without touching `contacts`, and the triggers above are what
// keep the copy honest. `contacts_owner_propagate` pushes an owner change down
// to all four, for a future admin "reassign data" action. It cannot touch the
// two vec0 tables, because sqlite-vec refuses an UPDATE of a partition key;
// that feature will delete and re-insert those rows in code.
//
// THE LOCAL OWNER is what makes auth-off mode work. Every instance has one
// account from boot: username `local`, `credentialState = 'none'`, a password
// hash that cannot parse. Nobody signs in as it. With auth off it is the
// implicit principal for a request with no credential, so every row written on
// a personal instance has a real owner rather than a NULL somebody later has
// to guess at. Securing the instance converts that row in place, keeping its
// id, which is how the data comes along without a claim.
//
// Reads do not filter on this column yet. Phase 2 adds the owner predicate to
// every query, through a repository layer that takes the owner as a required
// first argument — the failure mode of a forgotten `WHERE ownerId = ?` is a
// silent data leak with no error and no failing test, which is not something
// to defend with discipline across a hundred call sites. See
// docs/multi-tenant-plan/.
//
// dedupe_merge_log is the interesting one: it deliberately has no foreign key
// to contacts, because it stores snapshots of contacts that were hard-deleted
// and must outlive them. Nothing to join through, so its owner is copied from
// the surviving contact at write time rather than filled by a trigger.
//
// THE INVARIANT: `ownerId IS NULL` means "unowned — belongs to whoever owns
// this instance". Every row starts that way, and stays that way for as long
// as the instance has no accounts. Creating the first account claims all of
// them (see server/services/authService.ts → claimUnownedData), and a boot
// reconcile re-claims anything written while signed out. So NULL is a valid,
// meaningful state rather than a bug to be defended against.
//
// Nothing filters on this column yet. Doing so is the multi-tenancy project,
// and it needs a repository layer that takes the owner as a required argument
// — the failure mode of a forgotten `WHERE ownerId = ?` is a silent data leak
// with no error and no failing test, which is not something to defend with
// discipline across a hundred call sites.
//
// ON DELETE RESTRICT, not CASCADE. Cascade is what a mature multi-tenant app
// wants — remove an account, remove its data — but it is the wrong default to
// inherit *before* account deletion has been designed, because it turns
// `DELETE FROM users` into "silently destroy every contact". Restrict makes
// that fail loudly instead, which forces whoever builds account deletion to
// decide what should happen to the data rather than discovering the answer
// afterwards. `sessions` still cascades: a session without its account is
// meaningless, and nobody mourns it.
// =============================================================================

// =============================================================================
// Normalized Child Tables
// =============================================================================

/**
 * contact_emails — Multi-value emails with label, primary flag, and source
 * provenance so we know which import contributed each address.
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

/**
 * contact_phones — Multi-value phone numbers with label and provenance.
 */
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

/**
 * contact_addresses — Multi-value physical addresses parsed from inputs.
 */
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
 * contact_social_links — Typed social/professional profile URLs.
 * Platform field allows icon resolution and deduplication across imports.
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
 * contact_education — Normalized education history with separate date fields
 * and field-of-study support (richer than the old { school, degree, dates } blob).
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
 * contact_experience — Normalized work history with isCurrent flag,
 * separate start/end dates, and per-entry location.
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
 * contact_sources — Per-import provenance records. Tracks which platform
 * a contact was imported from, the external profile ID/URL, and the original
 * connection date (e.g. LinkedIn "Connected On").
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

/**
 * contact_tags — Flexible free-form tagging system for pipeline stages,
 * custom grouping, and relationship categorization.
 */
export const contactTags = sqliteTable("contact_tags", {
  id: text("id").primaryKey(),
  contactId: text("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
  addedAt: text("addedAt").default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_interests — Personal hobbies and interests extracted by AI
 * Kept separate from generic CRM tags to avoid cluttering pipeline management.
 */
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
 * contact_attributes — Flexible key-value store for domain-specific LLM extractions.
 * e.g., { name: "Investment Philosophy", value: "Focuses on early stage AI..." }
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

// =============================================================================
// Interactions (Timeline)
// =============================================================================

/**
 * interactions — Chronological timeline entries for each contact.
 * Expanded type enum supports platform-specific interaction logging.
 */
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

/**
 * interactionMentions — Bi-directional network weaving junction table natively resolving references.
 */
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

// =============================================================================
// Deduplication Engine Infrastructure
// =============================================================================

/**
 * dedupe_suggestions — Persistent match suggestions produced by the dedupe engine.
 * Each row represents a detected pair of contacts that may be duplicates.
 * Status tracks the lifecycle: pending → merged / dismissed / auto_merged.
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
  },
  (t) => ({
    unq: unique().on(t.contactIdA, t.contactIdB),
  }),
);

/**
 * dedupe_exclusions — User-dismissed contact pairs that should never be
 * re-suggested as duplicates. Acts as a permanent negative constraint.
 */
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
 * dedupe_merge_log — Audit trail for all merge operations (both user-initiated
 * hard merges and auto-triggered soft merges). Enables undo for soft merges
 * and forensic analysis of merge decisions.
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
   * Owning account. This table carries its own because it has no foreign key
   * to join through — the snapshots outlive the contacts they describe.
   */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

// =============================================================================
// Action Items (Proactive Follow-Up Tasks)
// =============================================================================

/**
 * action_items — First-class follow-up tasks linked to contacts.
 * Replaces the single `nextFollowUpAt` date field with a full entity that
 * supports multiple items per contact, descriptive titles, and completion tracking.
 * SQL triggers keep `contacts.nextFollowUpAt` in sync as a denormalized cache.
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

// =============================================================================
// Lists (User-Created Contact Groups)
// =============================================================================

/**
 * lists — User-created named contact groups with icon and drag-to-reorder support.
 */
export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("star"),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: text("createdAt").default(sql`(CURRENT_TIMESTAMP)`),
  /** Owning account — see the OWNERSHIP note above. */
  ownerId: text("ownerId").references(() => users.id, { onDelete: "restrict" }),
});

/**
 * list_members — Junction table connecting lists to contacts.
 * Composite PK ensures each contact appears in a list at most once.
 */
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

// =============================================================================
// AI Invocation Log (AI Stats Page)
// =============================================================================

/**
 * ai_invocations — Persistent audit log of every AI call (fresh and cached).
 * Standalone table with no foreign keys — invocations are independent events
 * that reference contacts/queries by description only.
 *
 * Used by the AI Stats Page (`/settings/ai-stats`) to surface historical
 * AI activity, token usage, cache performance, and approximate costs.
 *
 * Retention: 30-day rolling window, cleaned up on server startup.
 */
export const aiInvocations = sqliteTable("ai_invocations", {
  id: text("id").primaryKey(),
  /** Fixed vocabulary: briefing, rerank, mentions, synthesis, parse, searchExpansion, dailyInsight, emlSummary, bulkParse, aiSearchGrounding, aiSearchExtraction */
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

// =============================================================================
// Drizzle Relations (for relational query builder)
// =============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  contacts: many(contacts),
  lists: many(lists),
  interactions: many(interactions),
  actionItems: many(actionItems),
  apiTokens: many(apiTokens),
  userSettings: many(userSettings),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  inviter: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
    relationName: "invitationInviter",
  }),
  acceptor: one(users, {
    fields: [invitations.acceptedBy],
    references: [users.id],
    relationName: "invitationAcceptor",
  }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(users, { fields: [auditLog.actorUserId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  owner: one(users, {
    fields: [contacts.ownerId],
    references: [users.id],
  }),
  emails: many(contactEmails),
  phones: many(contactPhones),
  addresses: many(contactAddresses),
  socialLinks: many(contactSocialLinks),
  education: many(contactEducation),
  experience: many(contactExperience),
  sources: many(contactSources),
  tags: many(contactTags),
  interests: many(contactInterests),
  attributes: many(contactAttributes),
  interactions: many(interactions),
  mentionedIn: many(interactionMentions),
  actionItems: many(actionItems),
  canonical: one(contacts, {
    fields: [contacts.canonicalId],
    references: [contacts.id],
  }),
  dedupeSuggestionsA: many(dedupeSuggestions),
}));

export const dedupeSuggestionsRelations = relations(
  dedupeSuggestions,
  ({ one }) => ({
    contactA: one(contacts, {
      fields: [dedupeSuggestions.contactIdA],
      references: [contacts.id],
    }),
    contactB: one(contacts, {
      fields: [dedupeSuggestions.contactIdB],
      references: [contacts.id],
    }),
    owner: one(users, {
      fields: [dedupeSuggestions.ownerId],
      references: [users.id],
    }),
  }),
);

export const dedupeExclusionsRelations = relations(
  dedupeExclusions,
  ({ one }) => ({
    contactA: one(contacts, {
      fields: [dedupeExclusions.contactIdA],
      references: [contacts.id],
    }),
    contactB: one(contacts, {
      fields: [dedupeExclusions.contactIdB],
      references: [contacts.id],
    }),
    owner: one(users, {
      fields: [dedupeExclusions.ownerId],
      references: [users.id],
    }),
  }),
);

export const dedupeMergeLogRelations = relations(dedupeMergeLog, ({ one }) => ({
  primary: one(contacts, {
    fields: [dedupeMergeLog.primaryId],
    references: [contacts.id],
  }),
}));

export const contactEmailsRelations = relations(contactEmails, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactEmails.contactId],
    references: [contacts.id],
  }),
}));

export const contactPhonesRelations = relations(contactPhones, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactPhones.contactId],
    references: [contacts.id],
  }),
}));

export const contactAddressesRelations = relations(
  contactAddresses,
  ({ one }) => ({
    contact: one(contacts, {
      fields: [contactAddresses.contactId],
      references: [contacts.id],
    }),
  }),
);

export const contactSocialLinksRelations = relations(
  contactSocialLinks,
  ({ one }) => ({
    contact: one(contacts, {
      fields: [contactSocialLinks.contactId],
      references: [contacts.id],
    }),
  }),
);

export const contactEducationRelations = relations(
  contactEducation,
  ({ one }) => ({
    contact: one(contacts, {
      fields: [contactEducation.contactId],
      references: [contacts.id],
    }),
  }),
);

export const contactExperienceRelations = relations(
  contactExperience,
  ({ one }) => ({
    contact: one(contacts, {
      fields: [contactExperience.contactId],
      references: [contacts.id],
    }),
  }),
);

export const contactSourcesRelations = relations(contactSources, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactSources.contactId],
    references: [contacts.id],
  }),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactTags.contactId],
    references: [contacts.id],
  }),
}));

export const contactInterestsRelations = relations(
  contactInterests,
  ({ one }) => ({
    contact: one(contacts, {
      fields: [contactInterests.contactId],
      references: [contacts.id],
    }),
  }),
);

export const contactAttributesRelations = relations(
  contactAttributes,
  ({ one }) => ({
    contact: one(contacts, {
      fields: [contactAttributes.contactId],
      references: [contacts.id],
    }),
  }),
);

export const interactionsRelations = relations(
  interactions,
  ({ one, many }) => ({
    contact: one(contacts, {
      fields: [interactions.contactId],
      references: [contacts.id],
    }),
    owner: one(users, {
      fields: [interactions.ownerId],
      references: [users.id],
    }),
    mentions: many(interactionMentions),
  }),
);

export const interactionMentionsRelations = relations(
  interactionMentions,
  ({ one }) => ({
    interaction: one(interactions, {
      fields: [interactionMentions.interactionId],
      references: [interactions.id],
    }),
    contact: one(contacts, {
      fields: [interactionMentions.contactId],
      references: [contacts.id],
    }),
  }),
);

export const actionItemsRelations = relations(actionItems, ({ one }) => ({
  contact: one(contacts, {
    fields: [actionItems.contactId],
    references: [contacts.id],
  }),
  owner: one(users, {
    fields: [actionItems.ownerId],
    references: [users.id],
  }),
}));

export const listsRelations = relations(lists, ({ many }) => ({
  members: many(listMembers),
}));

export const listMembersRelations = relations(listMembers, ({ one }) => ({
  list: one(lists, { fields: [listMembers.listId], references: [lists.id] }),
  contact: one(contacts, {
    fields: [listMembers.contactId],
    references: [contacts.id],
  }),
}));
