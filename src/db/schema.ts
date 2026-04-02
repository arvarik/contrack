import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';
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
  isPremium: integer('isPremium').default(0),
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
  aiBriefingAt: text('aiBriefingAt'),
  isGhost: integer('isGhost').default(0),
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
  source: text('source'),
  addedAt: text('addedAt').default(sql`(CURRENT_TIMESTAMP)`),
});

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
  type: text('type', {
    enum: ['note', 'call', 'meeting', 'email', 'message', 'sms', 'import', 'linkedin', 'facebook'],
  }).notNull(),
  title: text('title').notNull(),
  content: text('content'),
  date: text('date').default(sql`(CURRENT_TIMESTAMP)`),
  duration: text('duration'),
  fileUrl: text('fileUrl'),
  fileName: text('fileName'),
  fileType: text('fileType'),
  source: text('source'),
  mentions: text('mentions'),
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
// Drizzle Relations (for relational query builder)
// =============================================================================

export const contactsRelations = relations(contacts, ({ many }) => ({
  emails: many(contactEmails),
  phones: many(contactPhones),
  socialLinks: many(contactSocialLinks),
  education: many(contactEducation),
  experience: many(contactExperience),
  sources: many(contactSources),
  tags: many(contactTags),
  interactions: many(interactions),
  mentionedIn: many(interactionMentions),
}));

export const contactEmailsRelations = relations(contactEmails, ({ one }) => ({
  contact: one(contacts, { fields: [contactEmails.contactId], references: [contacts.id] }),
}));

export const contactPhonesRelations = relations(contactPhones, ({ one }) => ({
  contact: one(contacts, { fields: [contactPhones.contactId], references: [contacts.id] }),
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

export const interactionsRelations = relations(interactions, ({ one, many }) => ({
  contact: one(contacts, { fields: [interactions.contactId], references: [contacts.id] }),
  mentions: many(interactionMentions),
}));

export const interactionMentionsRelations = relations(interactionMentions, ({ one }) => ({
  interaction: one(interactions, { fields: [interactionMentions.interactionId], references: [interactions.id] }),
  contact: one(contacts, { fields: [interactionMentions.contactId], references: [contacts.id] }),
}));
