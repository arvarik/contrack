// =============================================================================
// ContactRepository — Typed Data Access Layer
// =============================================================================
// Encapsulates all child-table hydration and persistence for the contacts
// entity. Replaces the monolithic hydrateContact() and insertChildRecords()
// functions from helpers.ts with typed Drizzle ORM queries.
//
// Design decisions:
// - Single class, not 10 repository classes — avoids over-engineering
// - Uses sqlite.prepare() for hydration queries (better-sqlite3 caches these)
// - Uses Drizzle insert() for mutations (type-safe column mapping)
// - Boolean conversion (SQLite 0/1 → JS boolean) handled centrally
// =============================================================================

import { sqlite, db } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import type { HydratedContact, ChildRecordsPayload } from "./types.ts";

// Re-export types for consumers
export type { HydratedContact, ChildRecordsPayload };

// =============================================================================
// URL Utilities (used by social link insertion)
// =============================================================================

function detectPlatformFromUrl(url: string): string {
  const l = url.toLowerCase();
  if (l.includes('linkedin.com')) return 'linkedin';
  if (l.includes('facebook.com') || l.includes('fb.com')) return 'facebook';
  if (l.includes('twitter.com') || l.includes('x.com')) return 'twitter';
  if (l.includes('github.com')) return 'github';
  if (l.includes('instagram.com')) return 'instagram';
  return 'other';
}

function extractHandleFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last && last !== 'in' && last !== 'profile.php' ? last : null;
  } catch { return null; }
}

// =============================================================================
// Prepared Statements for Hydration
// =============================================================================
// These are compiled once at module load and reused for every hydrate() call.
// better-sqlite3 caches prepared statements internally, making repeated
// .all(contactId) calls extremely fast (~µs per query).
// =============================================================================

const stmts = {
  emails: sqlite.prepare(
    "SELECT id, email, label, isPrimary, source FROM contact_emails WHERE contactId = ? ORDER BY isPrimary DESC"
  ),
  phones: sqlite.prepare(
    "SELECT id, phone, label, isPrimary, source FROM contact_phones WHERE contactId = ? ORDER BY isPrimary DESC"
  ),
  socialLinks: sqlite.prepare(
    "SELECT id, platform, url, handle, source FROM contact_social_links WHERE contactId = ?"
  ),
  education: sqlite.prepare(
    "SELECT id, school, degree, fieldOfStudy, startDate, endDate, description FROM contact_education WHERE contactId = ?"
  ),
  experience: sqlite.prepare(
    "SELECT id, company, role, startDate, endDate, isCurrent, description, location FROM contact_experience WHERE contactId = ?"
  ),
  sources: sqlite.prepare(
    "SELECT id, platform, externalId, connectedOn, importedAt FROM contact_sources WHERE contactId = ?"
  ),
  tags: sqlite.prepare(
    "SELECT id, tag FROM contact_tags WHERE contactId = ?"
  ),
  interests: sqlite.prepare(
    "SELECT id, interest, isAiGenerated FROM contact_interests WHERE contactId = ?"
  ),
  attributes: sqlite.prepare(
    "SELECT id, name, value FROM contact_attributes WHERE contactId = ?"
  ),
  addresses: sqlite.prepare(
    "SELECT id, address, label, isPrimary, source FROM contact_addresses WHERE contactId = ? ORDER BY isPrimary DESC"
  ),
  lists: sqlite.prepare(
    `SELECT l.id, l.name, l.icon FROM lists l
     JOIN list_members lm ON l.id = lm.listId
     WHERE lm.contactId = ?
     ORDER BY l.sortOrder ASC`
  ),
  interactionCount: sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM interactions WHERE contactId = ?"
  ),
};

// =============================================================================
// ContactRepository
// =============================================================================

export const contactRepo = {
  // -------------------------------------------------------------------------
  // Hydration — Read Side
  // -------------------------------------------------------------------------

  /**
   * Hydrate a single raw contact row into the full API response shape.
   * Joins all 10 child tables + list memberships + interaction count.
   *
   * @param contact - A raw row from the contacts table (or null/undefined)
   * @returns Fully hydrated contact with typed child arrays, or null
   */
  hydrate(contact: any): HydratedContact | null {
    if (!contact) return null;

    return {
      ...contact,
      emails: (stmts.emails.all(contact.id) as any[]).map(e => ({
        ...e,
        isPrimary: !!e.isPrimary,
      })),
      phones: (stmts.phones.all(contact.id) as any[]).map(p => ({
        ...p,
        isPrimary: !!p.isPrimary,
      })),
      socialLinks: stmts.socialLinks.all(contact.id),
      education: stmts.education.all(contact.id),
      experience: (stmts.experience.all(contact.id) as any[]).map(e => ({
        ...e,
        isCurrent: !!e.isCurrent,
      })),
      sources: stmts.sources.all(contact.id),
      tags: stmts.tags.all(contact.id),
      interests: stmts.interests.all(contact.id),
      attributes: stmts.attributes.all(contact.id),
      addresses: (stmts.addresses.all(contact.id) as any[]).map(a => ({
        ...a,
        isPrimary: !!a.isPrimary,
      })),
      lists: stmts.lists.all(contact.id),
      interactionCount: (stmts.interactionCount.get(contact.id) as any)?.cnt ?? 0,
    } as HydratedContact;
  },

  /**
   * Hydrate multiple contact rows in bulk.
   * Uses the same pre-compiled prepared statements — better-sqlite3 handles
   * the internal caching.
   *
   * @param contacts - Array of raw contact rows
   * @returns Array of fully hydrated contacts (nulls filtered out)
   */
  hydrateMany(contacts: any[]): HydratedContact[] {
    return contacts.map(c => contactRepo.hydrate(c)).filter(Boolean) as HydratedContact[];
  },

  // -------------------------------------------------------------------------
  // Child Record Persistence — Write Side
  // -------------------------------------------------------------------------

  /**
   * Insert normalized child records (emails, phones, tags, etc.) for a contact.
   * Handles the polymorphic input types (string | object unions) and normalizes
   * them into proper typed inserts.
   *
   * @param contactId - Foreign key UUID of the parent contact
   * @param body - Payload containing arrays of child record objects
   * @param sourceName - Origin stamp for provenance tracking (default: 'manual')
   */
  insertChildRecords(contactId: string, body: ChildRecordsPayload, sourceName = 'manual'): void {
    // ── Emails ──────────────────────────────────────────────────────────
    if (Array.isArray(body.emails)) {
      for (let i = 0; i < body.emails.length; i++) {
        const e = body.emails[i];
        const email = (typeof e === 'string' ? e : e.email)?.trim();
        if (!email) continue;
        db.insert(schema.contactEmails).values({
          id: crypto.randomUUID(),
          contactId,
          email,
          label: (typeof e === 'object' ? e.label : 'personal') || 'personal',
          isPrimary: typeof e === 'object' ? (e.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
          source: sourceName,
        }).run();
      }
    }

    // ── Phones ──────────────────────────────────────────────────────────
    if (Array.isArray(body.phones)) {
      for (let i = 0; i < body.phones.length; i++) {
        const p = body.phones[i];
        const phone = (typeof p === 'string' ? p : p.phone)?.trim();
        if (!phone) continue;
        db.insert(schema.contactPhones).values({
          id: crypto.randomUUID(),
          contactId,
          phone,
          label: (typeof p === 'object' ? p.label : 'mobile') || 'mobile',
          isPrimary: typeof p === 'object' ? (p.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
          source: sourceName,
        }).run();
      }
    }

    // ── Social Links ────────────────────────────────────────────────────
    if (Array.isArray(body.socialLinks)) {
      for (const sl of body.socialLinks) {
        const url = (typeof sl === 'string' ? sl : sl.url)?.trim();
        if (!url) continue;
        const platform = typeof sl === 'object' && sl.platform ? sl.platform : detectPlatformFromUrl(url);
        db.insert(schema.contactSocialLinks).values({
          id: crypto.randomUUID(),
          contactId,
          platform,
          url,
          handle: typeof sl === 'object' ? sl.handle || extractHandleFromUrl(url) : extractHandleFromUrl(url),
          source: sourceName,
        }).run();
      }
    }

    // ── Education ───────────────────────────────────────────────────────
    if (Array.isArray(body.education)) {
      for (const edu of body.education) {
        if (!edu?.school) continue;
        db.insert(schema.contactEducation).values({
          id: crypto.randomUUID(),
          contactId,
          school: edu.school,
          degree: edu.degree || null,
          fieldOfStudy: edu.fieldOfStudy || null,
          startDate: edu.startDate || null,
          endDate: edu.endDate || null,
          description: edu.description || null,
          source: sourceName,
        }).run();
      }
    }

    // ── Experience ──────────────────────────────────────────────────────
    if (Array.isArray(body.experience)) {
      for (const exp of body.experience) {
        if (!exp?.company) continue;
        db.insert(schema.contactExperience).values({
          id: crypto.randomUUID(),
          contactId,
          company: exp.company,
          role: exp.role || null,
          startDate: exp.startDate || null,
          endDate: exp.endDate || null,
          isCurrent: exp.isCurrent ? 1 : 0,
          description: exp.description || null,
          location: exp.location || null,
          source: sourceName,
        }).run();
      }
    }

    // ── Tags ────────────────────────────────────────────────────────────
    if (Array.isArray(body.tags)) {
      for (const tag of body.tags) {
        const val = (typeof tag === 'string' ? tag : tag.tag)?.trim();
        if (!val) continue;
        db.insert(schema.contactTags).values({
          id: crypto.randomUUID(),
          contactId,
          tag: val,
        }).run();
      }
    }

    // ── Sources ─────────────────────────────────────────────────────────
    if (Array.isArray(body.sources)) {
      for (const src of body.sources) {
        const platform = typeof src === 'string' ? src : src.platform;
        if (!platform) continue;
        db.insert(schema.contactSources).values({
          id: crypto.randomUUID(),
          contactId,
          platform,
          externalId: typeof src === 'object' ? src.externalId || null : null,
          connectedOn: typeof src === 'object' ? src.connectedOn || null : null,
          rawData: typeof src === 'object' ? src.rawData || null : null,
        }).run();
      }
    }

    // ── Interests ───────────────────────────────────────────────────────
    if (Array.isArray(body.interests)) {
      for (const item of body.interests) {
        const val = (typeof item === 'string' ? item : item.interest)?.trim();
        if (!val) continue;
        const isAi = (typeof item === 'object' && item.isAiGenerated === true) ? 1 : 0;
        sqlite.prepare(`
          INSERT INTO contact_interests (id, contactId, interest, isAiGenerated) 
          VALUES (?, ?, ?, ?) 
          ON CONFLICT(contactId, interest) DO UPDATE SET isAiGenerated = excluded.isAiGenerated
        `).run(crypto.randomUUID(), contactId, val, isAi);
      }
    }

    // ── Attributes ──────────────────────────────────────────────────────
    if (Array.isArray(body.attributes)) {
      for (const attr of body.attributes) {
        if (!attr?.name || !attr?.value) continue;
        sqlite.prepare(`
          INSERT INTO contact_attributes (id, contactId, name, value) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT(contactId, name) DO UPDATE SET value = excluded.value
        `).run(crypto.randomUUID(), contactId, attr.name.trim(), attr.value.trim());
      }
    }

    // ── Addresses ───────────────────────────────────────────────────────
    if (Array.isArray(body.addresses)) {
      for (let i = 0; i < body.addresses.length; i++) {
        const a = body.addresses[i];
        const address = (typeof a === 'string' ? a : a.address)?.trim();
        if (!address) continue;
        sqlite.prepare(`
          INSERT INTO contact_addresses (id, contactId, address, label, isPrimary, source) 
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(contactId, address) DO NOTHING
        `).run(
          crypto.randomUUID(), contactId, address,
          (typeof a === 'object' ? a.label : 'home') || 'home',
          typeof a === 'object' ? (a.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
          sourceName,
        );
      }
    }
  },

  // -------------------------------------------------------------------------
  // Granular Finders — for dedupe and other targeted queries
  // -------------------------------------------------------------------------

  findEmailsByContactId(contactId: string) {
    return stmts.emails.all(contactId) as Array<{ id: string; email: string; label: string | null; isPrimary: number; source: string | null }>;
  },

  findPhonesByContactId(contactId: string) {
    return stmts.phones.all(contactId) as Array<{ id: string; phone: string; label: string | null; isPrimary: number; source: string | null }>;
  },
};
