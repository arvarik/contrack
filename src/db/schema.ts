import { sqliteTable, text, integer, real, primaryKey, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';

// =============================================================================
// Core Tables
// =============================================================================

/**
 * contacts — Primary entity table. Stores demographic, geospatial, and CRM
 * metadata. All multi-value fields (emails, phones, etc.) are normalized into
 * dedicated child tables linked by contactId.
 */
export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  firstName: text('firstName'),
  lastName: text('lastName'),
  headline: text('headline'),
  role: text('role'),
  company: text('company'),
  location: text('location'),
  birthday: text('birthday'),
  preferences: text('preferences'),
  avatarUrl: text('avatarUrl'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updatedAt').default(sql`(CURRENT_TIMESTAMP)`),
  cadenceDays: integer('cadenceDays').default(90),
  lastContactedAt: text('lastContactedAt'),
  nextFollowUpAt: text('nextFollowUpAt'),
  themeColor: text('themeColor').default('brand'),
  about: text('about'),
  pronouns: text('pronouns'),
  industry: text('industry'),
  website: text('website'),
  lat: real('lat'),
  lng: real('lng'),
  aiBriefing: text('aiBriefing'),
  aiBackground: text('aiBackground'),
  aiSummary: text('aiSummary'),
  aiHydratedAt: text('aiHydratedAt'),
  aiBriefingAt: text('aiBriefingAt'),
  isGhost: integer('isGhost').default(0),
  isArchived: integer('isArchived').default(0),
  relationshipScore: integer('relationshipScore').default(50),
  // Dedupe infrastructure (Phase 1)
  canonicalId: text('canonicalId'),  // Soft merge: points to primary contact's id. NULL = active contact.
  phoneticHash: text('phoneticHash'),  // Double Metaphone encoding for phonetic blocking.
});

// =============================================================================
// Normalized Child Tables
// =============================================================================

/**
 * contact_emails — Multi-value emails with label, primary flag, and source
 * provenance so we know which import contributed each address.
 */
export const contactEmails = sqliteTable('contact_emails', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  label: text('label').default('personal'),
  isPrimary: integer('isPrimary').default(0),
  sortOrder: integer('sortOrder').default(0),
  source: text('source'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_phones — Multi-value phone numbers with label and provenance.
 */
export const contactPhones = sqliteTable('contact_phones', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  label: text('label').default('mobile'),
  isPrimary: integer('isPrimary').default(0),
  sortOrder: integer('sortOrder').default(0),
  source: text('source'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_addresses — Multi-value physical addresses parsed from inputs.
 */
export const contactAddresses = sqliteTable('contact_addresses', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  label: text('label').default('home'),
  isPrimary: integer('isPrimary').default(0),
  sortOrder: integer('sortOrder').default(0),
  source: text('source'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  unq: unique().on(t.contactId, t.address),
}));

/**
 * contact_social_links — Typed social/professional profile URLs.
 * Platform field allows icon resolution and deduplication across imports.
 */
export const contactSocialLinks = sqliteTable('contact_social_links', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  url: text('url').notNull(),
  handle: text('handle'),
  source: text('source'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_education — Normalized education history with separate date fields
 * and field-of-study support (richer than the old { school, degree, dates } blob).
 */
export const contactEducation = sqliteTable('contact_education', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  school: text('school').notNull(),
  degree: text('degree'),
  fieldOfStudy: text('fieldOfStudy'),
  startDate: text('startDate'),
  endDate: text('endDate'),
  description: text('description'),
  source: text('source'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_experience — Normalized work history with isCurrent flag,
 * separate start/end dates, and per-entry location.
 */
export const contactExperience = sqliteTable('contact_experience', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  role: text('role'),
  startDate: text('startDate'),
  endDate: text('endDate'),
  isCurrent: integer('isCurrent').default(0),
  description: text('description'),
  location: text('location'),
  source: text('source'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_sources — Per-import provenance records. Tracks which platform
 * a contact was imported from, the external profile ID/URL, and the original
 * connection date (e.g. LinkedIn "Connected On").
 */
export const contactSources = sqliteTable('contact_sources', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  externalId: text('externalId'),
  connectedOn: text('connectedOn'),
  importedAt: text('importedAt').default(sql`(CURRENT_TIMESTAMP)`),
  rawData: text('rawData'),
});

/**
 * contact_tags — Flexible free-form tagging system for pipeline stages,
 * custom grouping, and relationship categorization.
 */
export const contactTags = sqliteTable('contact_tags', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * contact_interests — Personal hobbies and interests extracted by AI
 * Kept separate from generic CRM tags to avoid cluttering pipeline management.
 */
export const contactInterests = sqliteTable('contact_interests', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  interest: text('interest').notNull(),
  isAiGenerated: integer('isAiGenerated', { mode: 'boolean' }).default(false),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  unq: unique().on(t.contactId, t.interest),
}));

/**
 * contact_attributes — Flexible key-value store for domain-specific LLM extractions.
 * e.g., { name: "Investment Philosophy", value: "Focuses on early stage AI..." }
 */
export const contactAttributes = sqliteTable('contact_attributes', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  value: text('value').notNull(),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  unq: unique().on(t.contactId, t.name),
}));

// =============================================================================
// Interactions (Timeline)
// =============================================================================

/**
 * interactions — Chronological timeline entries for each contact.
 * Expanded type enum supports platform-specific interaction logging.
 */
export const interactions = sqliteTable('interactions', {
  id: text('id').primaryKey(),
  contactId: text('contactId')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  date: text('date').default(sql`(CURRENT_TIMESTAMP)`),
  duration: text('duration'),
  fileUrl: text('fileUrl'),
  fileName: text('fileName'),
  fileType: text('fileType'),
  source: text('source'),
  mentions: text('mentions'),
  updatedAt: text('updatedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * interactionMentions — Bi-directional network weaving junction table natively resolving references.
 */
export const interactionMentions = sqliteTable('interaction_mentions', {
  interactionId: text('interactionId').notNull()
    .references(() => interactions.id, { onDelete: 'cascade' }),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.interactionId, t.contactId] }),
}));

// =============================================================================
// Deduplication Engine Infrastructure
// =============================================================================

/**
 * dedupe_suggestions — Persistent match suggestions produced by the dedupe engine.
 * Each row represents a detected pair of contacts that may be duplicates.
 * Status tracks the lifecycle: pending → merged / dismissed / auto_merged.
 */
export const dedupeSuggestions = sqliteTable('dedupe_suggestions', {
  id: text('id').primaryKey(),
  contactIdA: text('contactIdA').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  contactIdB: text('contactIdB').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  matchType: text('matchType').notNull(),           // 'email' | 'phone' | 'name' | 'nickname' | 'embedding' | 'ai'
  confidence: real('confidence').notNull(),
  reasoning: text('reasoning').notNull(),
  matchedField: text('matchedField'),
  status: text('status').notNull().default('pending'),  // 'pending' | 'merged' | 'dismissed' | 'auto_merged'
  createdAt: text('createdAt').default(sql`(CURRENT_TIMESTAMP)`),
  reviewedAt: text('reviewedAt'),
  reviewedBy: text('reviewedBy'),                    // 'user' | 'auto'
}, (t) => ({
  unq: unique().on(t.contactIdA, t.contactIdB),
}));

/**
 * dedupe_exclusions — User-dismissed contact pairs that should never be
 * re-suggested as duplicates. Acts as a permanent negative constraint.
 */
export const dedupeExclusions = sqliteTable('dedupe_exclusions', {
  contactIdA: text('contactIdA').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  contactIdB: text('contactIdB').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  createdAt: text('createdAt').default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  pk: primaryKey({ columns: [t.contactIdA, t.contactIdB] }),
}));

/**
 * dedupe_merge_log — Audit trail for all merge operations (both user-initiated
 * hard merges and auto-triggered soft merges). Enables undo for soft merges
 * and forensic analysis of merge decisions.
 */
export const dedupeMergeLog = sqliteTable('dedupe_merge_log', {
  id: text('id').primaryKey(),
  primaryId: text('primaryId').notNull(),
  duplicateId: text('duplicateId').notNull(),
  mergedBy: text('mergedBy').notNull(),             // 'user' | 'auto'
  mergeType: text('mergeType').notNull(),            // 'soft' | 'hard'
  confidence: real('confidence').notNull(),
  reasoning: text('reasoning').notNull(),
  mergedAt: text('mergedAt').default(sql`(CURRENT_TIMESTAMP)`),
  undoneAt: text('undoneAt'),
  duplicateSnapshot: text('duplicateSnapshot'),      // JSON blob for hard deletes
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
export const actionItems = sqliteTable('action_items', {
  id: text('id').primaryKey(),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  interactionId: text('interactionId')
    .references(() => interactions.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  dueAt: text('dueAt').notNull(),
  completedAt: text('completedAt'),
  createdAt: text('createdAt').default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updatedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

// =============================================================================
// Lists (User-Created Contact Groups)
// =============================================================================

/**
 * lists — User-created named contact groups with icon and drag-to-reorder support.
 */
export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('star'),
  sortOrder: integer('sortOrder').notNull().default(0),
  createdAt: text('createdAt').default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * list_members — Junction table connecting lists to contacts.
 * Composite PK ensures each contact appears in a list at most once.
 */
export const listMembers = sqliteTable('list_members', {
  listId: text('listId').notNull()
    .references(() => lists.id, { onDelete: 'cascade' }),
  contactId: text('contactId').notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  pk: primaryKey({ columns: [t.listId, t.contactId] }),
}));

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
export const aiInvocations = sqliteTable('ai_invocations', {
  id: text('id').primaryKey(),
  /** Fixed vocabulary: briefing, rerank, mentions, synthesis, parse, searchExpansion, dailyInsight, emlSummary, bulkParse, aiSearchGrounding, aiSearchExtraction */
  operation: text('operation').notNull(),
  /** Model ID that served this request (null for cached responses) */
  model: text('model'),
  /** Total token count — input + output combined (null for cached responses) */
  tokenCount: integer('tokenCount'),
  /** Wall-clock latency in milliseconds (<1 for cache hits) */
  latencyMs: integer('latencyMs').notNull(),
  /** Whether this response was served from aiCache (0|1 boolean) */
  cached: integer('cached').notNull().default(0),
  /** Contextual one-liner, e.g. "Catch-Me-Up for Julian Rivera" */
  description: text('description'),
  createdAt: text('createdAt').notNull().default(sql`(datetime('now'))`),
});

// =============================================================================
// Drizzle Relations (for relational query builder)
// =============================================================================

export const contactsRelations = relations(contacts, ({ one, many }) => ({
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
  canonical: one(contacts, { fields: [contacts.canonicalId], references: [contacts.id] }),
  dedupeSuggestionsA: many(dedupeSuggestions),
}));

export const dedupeSuggestionsRelations = relations(dedupeSuggestions, ({ one }) => ({
  contactA: one(contacts, { fields: [dedupeSuggestions.contactIdA], references: [contacts.id] }),
  contactB: one(contacts, { fields: [dedupeSuggestions.contactIdB], references: [contacts.id] }),
}));

export const dedupeExclusionsRelations = relations(dedupeExclusions, ({ one }) => ({
  contactA: one(contacts, { fields: [dedupeExclusions.contactIdA], references: [contacts.id] }),
  contactB: one(contacts, { fields: [dedupeExclusions.contactIdB], references: [contacts.id] }),
}));

export const dedupeMergeLogRelations = relations(dedupeMergeLog, ({ one }) => ({
  primary: one(contacts, { fields: [dedupeMergeLog.primaryId], references: [contacts.id] }),
}));

export const contactEmailsRelations = relations(contactEmails, ({ one }) => ({
  contact: one(contacts, { fields: [contactEmails.contactId], references: [contacts.id] }),
}));

export const contactPhonesRelations = relations(contactPhones, ({ one }) => ({
  contact: one(contacts, { fields: [contactPhones.contactId], references: [contacts.id] }),
}));

export const contactAddressesRelations = relations(contactAddresses, ({ one }) => ({
  contact: one(contacts, { fields: [contactAddresses.contactId], references: [contacts.id] }),
}));

export const contactSocialLinksRelations = relations(contactSocialLinks, ({ one }) => ({
  contact: one(contacts, { fields: [contactSocialLinks.contactId], references: [contacts.id] }),
}));

export const contactEducationRelations = relations(contactEducation, ({ one }) => ({
  contact: one(contacts, { fields: [contactEducation.contactId], references: [contacts.id] }),
}));

export const contactExperienceRelations = relations(contactExperience, ({ one }) => ({
  contact: one(contacts, { fields: [contactExperience.contactId], references: [contacts.id] }),
}));

export const contactSourcesRelations = relations(contactSources, ({ one }) => ({
  contact: one(contacts, { fields: [contactSources.contactId], references: [contacts.id] }),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, { fields: [contactTags.contactId], references: [contacts.id] }),
}));

export const contactInterestsRelations = relations(contactInterests, ({ one }) => ({
  contact: one(contacts, { fields: [contactInterests.contactId], references: [contacts.id] }),
}));

export const contactAttributesRelations = relations(contactAttributes, ({ one }) => ({
  contact: one(contacts, { fields: [contactAttributes.contactId], references: [contacts.id] }),
}));

export const interactionsRelations = relations(interactions, ({ one, many }) => ({
  contact: one(contacts, { fields: [interactions.contactId], references: [contacts.id] }),
  mentions: many(interactionMentions),
}));

export const interactionMentionsRelations = relations(interactionMentions, ({ one }) => ({
  interaction: one(interactions, { fields: [interactionMentions.interactionId], references: [interactions.id] }),
  contact: one(contacts, { fields: [interactionMentions.contactId], references: [contacts.id] }),
}));

export const actionItemsRelations = relations(actionItems, ({ one }) => ({
  contact: one(contacts, { fields: [actionItems.contactId], references: [contacts.id] }),
}));

export const listsRelations = relations(lists, ({ many }) => ({
  members: many(listMembers),
}));

export const listMembersRelations = relations(listMembers, ({ one }) => ({
  list: one(lists, { fields: [listMembers.listId], references: [lists.id] }),
  contact: one(contacts, { fields: [listMembers.contactId], references: [contacts.id] }),
}));
