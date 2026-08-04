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

// Central registry of contact child relations for OCP extensibility
export const RELATION_REGISTRY = {
  emails: { table: schema.contactEmails, dbName: "contact_emails" },
  phones: { table: schema.contactPhones, dbName: "contact_phones" },
  socialLinks: {
    table: schema.contactSocialLinks,
    dbName: "contact_social_links",
  },
  tags: { table: schema.contactTags, dbName: "contact_tags" },
  interests: { table: schema.contactInterests, dbName: "contact_interests" },
  addresses: { table: schema.contactAddresses, dbName: "contact_addresses" },
  attributes: { table: schema.contactAttributes, dbName: "contact_attributes" },
  education: { table: schema.contactEducation, dbName: "contact_education" },
  experience: { table: schema.contactExperience, dbName: "contact_experience" },
  sources: { table: schema.contactSources, dbName: "contact_sources" },
} as const;

// =============================================================================
// URL Utilities (used by social link insertion)
// =============================================================================

function detectPlatformFromUrl(url: string): string {
  const l = url.toLowerCase();
  if (l.includes("linkedin.com")) return "linkedin";
  if (l.includes("facebook.com") || l.includes("fb.com")) return "facebook";
  if (l.includes("twitter.com") || l.includes("x.com")) return "twitter";
  if (l.includes("github.com")) return "github";
  if (l.includes("instagram.com")) return "instagram";
  return "other";
}

function extractHandleFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last && last !== "in" && last !== "profile.php" ? last : null;
  } catch {
    return null;
  }
}

/**
 * Check if a URL matches a known-dead service pattern.
 * These services are permanently shut down — every link is guaranteed broken.
 * Using a blocklist (not HTTP checks) keeps import instant and offline-capable.
 */
const DEAD_URL_PATTERNS = [
  "profiles.google.com", // Google Profiles — shut down 2012
  "google.com/profiles/", // Google Profiles alt URL format (from VCF exports)
  "plus.google.com", // Google+ — shut down April 2019
  "plus.url.google.com", // Google+ URL shortener
  "orkut.com", // Orkut — shut down September 2014
  "orkut.google.com", // Orkut alt domain
  "vine.co", // Vine — shut down January 2017
] as const;

function isDeadLinkPattern(url: string): boolean {
  const lower = url.toLowerCase();
  return DEAD_URL_PATTERNS.some((pattern) => lower.includes(pattern));
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
    "SELECT id, email, label, isPrimary, sortOrder, source FROM contact_emails WHERE contactId = ? ORDER BY sortOrder ASC",
  ),
  phones: sqlite.prepare(
    "SELECT id, phone, label, isPrimary, sortOrder, source FROM contact_phones WHERE contactId = ? ORDER BY sortOrder ASC",
  ),
  socialLinks: sqlite.prepare(
    "SELECT id, platform, url, handle, source FROM contact_social_links WHERE contactId = ?",
  ),
  education: sqlite.prepare(
    "SELECT id, school, degree, fieldOfStudy, startDate, endDate, description FROM contact_education WHERE contactId = ?",
  ),
  experience: sqlite.prepare(
    "SELECT id, company, role, startDate, endDate, isCurrent, description, location FROM contact_experience WHERE contactId = ?",
  ),
  sources: sqlite.prepare(
    "SELECT id, platform, externalId, connectedOn, importedAt FROM contact_sources WHERE contactId = ?",
  ),
  tags: sqlite.prepare("SELECT id, tag FROM contact_tags WHERE contactId = ?"),
  interests: sqlite.prepare(
    "SELECT id, interest, isAiGenerated FROM contact_interests WHERE contactId = ?",
  ),
  attributes: sqlite.prepare(
    "SELECT id, name, value FROM contact_attributes WHERE contactId = ?",
  ),
  addresses: sqlite.prepare(
    "SELECT id, address, label, isPrimary, sortOrder, source FROM contact_addresses WHERE contactId = ? ORDER BY sortOrder ASC",
  ),
  lists: sqlite.prepare(
    `SELECT l.id, l.name, l.icon FROM lists l
     JOIN list_members lm ON l.id = lm.listId
     WHERE lm.contactId = ?
     ORDER BY l.sortOrder ASC`,
  ),
  interactionCount: sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM interactions WHERE contactId = ?",
  ),
};

/**
 * A raw contact row as returned by better-sqlite3 `prepare().get()` or `.all()`.
 *
 * Intentionally loose — callers pass different column subsets depending on the
 * query (slim view, full select, dedupe engine, etc.). Only `id` is required
 * for child-table JOINs.
 *
 * NOTE: Drizzle's InferSelectModel<typeof schema.contacts> is stricter than what
 * better-sqlite3 actually returns (it returns numbers for booleans, etc.),
 * so we use a pragmatic Record-based type here.
 */
export type RawContactRow = Record<string, unknown> & { id: string };

export const contactRepo = {
  // -------------------------------------------------------------------------
  // Hydration — Read Side
  // -------------------------------------------------------------------------

  /**
   * Hydrate a single raw contact row into the full API response shape.
   * Joins all 10 child tables + list memberships + interaction count.
   *
   * Accepts `unknown` for ergonomic use with `sqlite.prepare().get()` which
   * returns `unknown`. Performs a runtime type-narrowing guard internally.
   *
   * @param contact - A raw row from the contacts table, or null/undefined/unknown
   * @returns Fully hydrated contact with typed child arrays, or null
   */
  hydrate(contact: unknown): HydratedContact | null {
    if (!contact || typeof contact !== "object" || !("id" in contact))
      return null;
    const row = contact as RawContactRow;

    return {
      ...row,
      emails: (stmts.emails.all(row.id) as Array<Record<string, unknown>>).map(
        (e) => ({
          ...e,
          isPrimary: !!e.isPrimary,
        }),
      ),
      phones: (stmts.phones.all(row.id) as Array<Record<string, unknown>>).map(
        (p) => ({
          ...p,
          isPrimary: !!p.isPrimary,
        }),
      ),
      socialLinks: stmts.socialLinks.all(row.id),
      education: stmts.education.all(row.id),
      experience: (
        stmts.experience.all(row.id) as Array<Record<string, unknown>>
      ).map((e) => ({
        ...e,
        isCurrent: !!e.isCurrent,
      })),
      sources: stmts.sources.all(row.id),
      tags: stmts.tags.all(row.id),
      interests: stmts.interests.all(row.id),
      attributes: stmts.attributes.all(row.id),
      addresses: (
        stmts.addresses.all(row.id) as Array<Record<string, unknown>>
      ).map((a) => ({
        ...a,
        isPrimary: !!a.isPrimary,
      })),
      lists: stmts.lists.all(row.id),
      interactionCount:
        (stmts.interactionCount.get(row.id) as { cnt: number } | undefined)
          ?.cnt ?? 0,
    } as HydratedContact;
  },

  /**
   * Hydrate multiple contact rows in bulk.
   * Leverages high-performance chunked SQL batch loading to bypass N+1 queries.
   *
   * @param contacts - Array of raw contact rows
   * @returns Array of fully hydrated contacts (nulls filtered out)
   */
  hydrateMany(contacts: unknown[]): HydratedContact[] {
    if (!contacts || contacts.length === 0) return [];

    // Filter out invalid records
    const validContacts = contacts.filter(
      (c): c is RawContactRow =>
        c !== null && typeof c === "object" && "id" in c,
    );
    if (validContacts.length === 0) return [];

    // For very small inputs (e.g. <= 3 contacts), sequential hydration using
    // pre-compiled statements has less overhead than bulk query preparation.
    if (validContacts.length <= 3) {
      return validContacts
        .map((c) => contactRepo.hydrate(c))
        .filter(Boolean) as HydratedContact[];
    }

    const ids = validContacts.map((c) => c.id);
    const CHUNK_SIZE = 500;

    // Helper to query in chunks of 500 to stay safely under SQLite parameter limits
    const queryInChunks = <T>(
      baseQuery: string,
      idField: string,
      orderBy: string = "",
    ): T[] => {
      const results: T[] = [];
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        const sql = `${baseQuery} WHERE ${idField} IN (${placeholders}) ${orderBy}`;
        results.push(...(sqlite.prepare(sql).all(chunk) as T[]));
      }
      return results;
    };

    // Load all relation child tables in chunked bulk queries
    const emailRows = queryInChunks<{
      id: string;
      contactId: string;
      email: string;
      label: string | null;
      isPrimary: number;
      sortOrder: number;
      source: string;
    }>(
      "SELECT id, contactId, email, label, isPrimary, sortOrder, source FROM contact_emails",
      "contactId",
      "ORDER BY sortOrder ASC",
    );

    const phoneRows = queryInChunks<{
      id: string;
      contactId: string;
      phone: string;
      label: string | null;
      isPrimary: number;
      sortOrder: number;
      source: string;
    }>(
      "SELECT id, contactId, phone, label, isPrimary, sortOrder, source FROM contact_phones",
      "contactId",
      "ORDER BY sortOrder ASC",
    );

    const socialRows = queryInChunks<{
      id: string;
      contactId: string;
      platform: string;
      url: string;
      handle: string | null;
      source: string;
    }>(
      "SELECT id, contactId, platform, url, handle, source FROM contact_social_links",
      "contactId",
    );

    const eduRows = queryInChunks<{
      id: string;
      contactId: string;
      school: string;
      degree: string | null;
      fieldOfStudy: string | null;
      startDate: string | null;
      endDate: string | null;
      description: string | null;
    }>(
      "SELECT id, contactId, school, degree, fieldOfStudy, startDate, endDate, description FROM contact_education",
      "contactId",
    );

    const expRows = queryInChunks<{
      id: string;
      contactId: string;
      company: string;
      role: string | null;
      startDate: string | null;
      endDate: string | null;
      isCurrent: number;
      description: string | null;
      location: string | null;
    }>(
      "SELECT id, contactId, company, role, startDate, endDate, isCurrent, description, location FROM contact_experience",
      "contactId",
    );

    const sourceRows = queryInChunks<{
      id: string;
      contactId: string;
      platform: string;
      externalId: string | null;
      connectedOn: string | null;
      importedAt: string | null;
    }>(
      "SELECT id, contactId, platform, externalId, connectedOn, importedAt FROM contact_sources",
      "contactId",
    );

    const tagRows = queryInChunks<{
      id: string;
      contactId: string;
      tag: string;
    }>("SELECT id, contactId, tag FROM contact_tags", "contactId");

    const interestRows = queryInChunks<{
      id: string;
      contactId: string;
      interest: string;
      isAiGenerated: number;
    }>(
      "SELECT id, contactId, interest, isAiGenerated FROM contact_interests",
      "contactId",
    );

    const attrRows = queryInChunks<{
      id: string;
      contactId: string;
      name: string;
      value: string;
    }>(
      "SELECT id, contactId, name, value FROM contact_attributes",
      "contactId",
    );

    const addrRows = queryInChunks<{
      id: string;
      contactId: string;
      address: string;
      label: string | null;
      isPrimary: number;
      sortOrder: number;
      source: string;
    }>(
      "SELECT id, contactId, address, label, isPrimary, sortOrder, source FROM contact_addresses",
      "contactId",
      "ORDER BY sortOrder ASC",
    );

    // Specialized list memberships chunked query
    const listRows: {
      contactId: string;
      id: string;
      name: string;
      icon: string | null;
    }[] = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `
        SELECT lm.contactId, l.id, l.name, l.icon 
        FROM lists l
        JOIN list_members lm ON l.id = lm.listId
        WHERE lm.contactId IN (${placeholders})
        ORDER BY l.sortOrder ASC
      `;
      listRows.push(...(sqlite.prepare(sql).all(chunk) as typeof listRows));
    }

    // Specialized interaction count chunked query
    const countRows: { contactId: string; cnt: number }[] = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `
        SELECT contactId, COUNT(*) as cnt 
        FROM interactions 
        WHERE contactId IN (${placeholders}) 
        GROUP BY contactId
      `;
      countRows.push(...(sqlite.prepare(sql).all(chunk) as typeof countRows));
    }

    // Helper to group flat rows by contactId in O(N)
    const groupByContact = <T extends { contactId: string }>(
      rows: T[],
    ): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const r of rows) {
        if (!map.has(r.contactId)) map.set(r.contactId, []);
        map.get(r.contactId)!.push(r);
      }
      return map;
    };

    const emailsMap = groupByContact(emailRows);
    const phonesMap = groupByContact(phoneRows);
    const socialMap = groupByContact(socialRows);
    const eduMap = groupByContact(eduRows);
    const expMap = groupByContact(expRows);
    const sourceMap = groupByContact(sourceRows);
    const tagsMap = groupByContact(tagRows);
    const interestsMap = groupByContact(interestRows);
    const attrsMap = groupByContact(attrRows);
    const addrsMap = groupByContact(addrRows);
    const listsMap = groupByContact(listRows);
    const countsMap = new Map(countRows.map((r) => [r.contactId, r.cnt]));

    // Reconstruct fully hydrated contact structures in JS
    return validContacts.map(
      (row) =>
        ({
          ...row,
          emails: (emailsMap.get(row.id) ?? []).map(({ contactId, ...e }) => ({
            ...e,
            isPrimary: !!e.isPrimary,
          })),
          phones: (phonesMap.get(row.id) ?? []).map(({ contactId, ...p }) => ({
            ...p,
            isPrimary: !!p.isPrimary,
          })),
          socialLinks: (socialMap.get(row.id) ?? []).map(
            ({ contactId, ...s }) => s,
          ),
          education: (eduMap.get(row.id) ?? []).map(
            ({ contactId, ...edu }) => edu,
          ),
          experience: (expMap.get(row.id) ?? []).map(({ contactId, ...e }) => ({
            ...e,
            isCurrent: !!e.isCurrent,
          })),
          sources: (sourceMap.get(row.id) ?? []).map(
            ({ contactId, ...src }) => src,
          ),
          tags: (tagsMap.get(row.id) ?? []).map(({ contactId, ...t }) => t),
          interests: (interestsMap.get(row.id) ?? []).map(
            ({ contactId, ...i }) => i,
          ),
          attributes: (attrsMap.get(row.id) ?? []).map(
            ({ contactId, ...attr }) => attr,
          ),
          addresses: (addrsMap.get(row.id) ?? []).map(
            ({ contactId, ...a }) => ({
              ...a,
              isPrimary: !!a.isPrimary,
            }),
          ),
          lists: (listsMap.get(row.id) ?? []).map(
            ({ contactId, ...list }) => list,
          ),
          interactionCount: countsMap.get(row.id) ?? 0,
        }) as unknown as HydratedContact,
    );
  },

  // -------------------------------------------------------------------------
  // Child Record Persistence — Write Side
  // -------------------------------------------------------------------------

  /**
   * Insert normalized child records (emails, phones, tags, etc.) for a contact.
   * Handles the polymorphic input types (string | object unions) and normalizes
   * them into proper typed inserts.
   *
   * ATOMICITY: All ten child-table inserts run inside a single `sqlite.transaction`.
   * If any individual `.run()` throws (FK violation, UNIQUE conflict on
   * attributes/interests/addresses, etc.) the entire batch is rolled back —
   * we never leave a contact with partial child rows. better-sqlite3
   * transactions are synchronous, which suits this loop perfectly.
   *
   * @param contactId - Foreign key UUID of the parent contact
   * @param body - Payload containing arrays of child record objects
   * @param sourceName - Origin stamp for provenance tracking (default: 'manual')
   */
  insertChildRecords(
    contactId: string,
    body: ChildRecordsPayload,
    sourceName = "manual",
  ): void {
    const txn = sqlite.transaction(() =>
      contactRepo._insertChildRecordsUnsafe(contactId, body, sourceName),
    );
    txn();
  },

  /**
   * INTERNAL — caller MUST hold an open transaction. Used by
   * `insertChildRecords` (which opens its own) and by any service that
   * already runs inside a wider transaction (e.g. bulk import) to avoid
   * nested-transaction errors.
   */
  _insertChildRecordsUnsafe(
    contactId: string,
    body: ChildRecordsPayload,
    sourceName = "manual",
  ): void {
    // ── Emails ──────────────────────────────────────────────────────────
    if (Array.isArray(body.emails)) {
      for (let i = 0; i < body.emails.length; i++) {
        const e = body.emails[i];
        const email = (typeof e === "string" ? e : e.email)?.trim();
        if (!email) continue;
        db.insert(schema.contactEmails)
          .values({
            id: crypto.randomUUID(),
            contactId,
            email,
            label: (typeof e === "object" ? e.label : "personal") || "personal",
            isPrimary:
              typeof e === "object" ? (e.isPrimary ? 1 : 0) : i === 0 ? 1 : 0,
            sortOrder: i,
            source: sourceName,
          })
          .run();
      }
    }

    // ── Phones ──────────────────────────────────────────────────────────
    if (Array.isArray(body.phones)) {
      for (let i = 0; i < body.phones.length; i++) {
        const p = body.phones[i];
        const phone = (typeof p === "string" ? p : p.phone)?.trim();
        if (!phone) continue;
        db.insert(schema.contactPhones)
          .values({
            id: crypto.randomUUID(),
            contactId,
            phone,
            label: (typeof p === "object" ? p.label : "mobile") || "mobile",
            isPrimary:
              typeof p === "object" ? (p.isPrimary ? 1 : 0) : i === 0 ? 1 : 0,
            sortOrder: i,
            source: sourceName,
          })
          .run();
      }
    }

    // ── Social Links ────────────────────────────────────────────────────
    if (Array.isArray(body.socialLinks)) {
      for (const sl of body.socialLinks) {
        const url = (typeof sl === "string" ? sl : sl.url)?.trim();
        if (!url) continue;
        if (isDeadLinkPattern(url)) continue; // Skip known-dead URLs
        const platform =
          typeof sl === "object" && sl.platform
            ? sl.platform
            : detectPlatformFromUrl(url);
        db.insert(schema.contactSocialLinks)
          .values({
            id: crypto.randomUUID(),
            contactId,
            platform,
            url,
            handle:
              typeof sl === "object"
                ? sl.handle || extractHandleFromUrl(url)
                : extractHandleFromUrl(url),
            source: sourceName,
          })
          .run();
      }
    }

    // ── Education ───────────────────────────────────────────────────────
    if (Array.isArray(body.education)) {
      for (const edu of body.education) {
        if (!edu?.school) continue;
        db.insert(schema.contactEducation)
          .values({
            id: crypto.randomUUID(),
            contactId,
            school: edu.school,
            degree: edu.degree || null,
            fieldOfStudy: edu.fieldOfStudy || null,
            startDate: edu.startDate || null,
            endDate: edu.endDate || null,
            description: edu.description || null,
            source: sourceName,
          })
          .run();
      }
    }

    // ── Experience ──────────────────────────────────────────────────────
    if (Array.isArray(body.experience)) {
      for (const exp of body.experience) {
        if (!exp?.company) continue;
        db.insert(schema.contactExperience)
          .values({
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
          })
          .run();
      }
    }

    // ── Tags ────────────────────────────────────────────────────────────
    if (Array.isArray(body.tags)) {
      for (const tag of body.tags) {
        const val = (typeof tag === "string" ? tag : tag.tag)?.trim();
        if (!val) continue;
        db.insert(schema.contactTags)
          .values({
            id: crypto.randomUUID(),
            contactId,
            tag: val,
          })
          .run();
      }
    }

    // ── Sources ─────────────────────────────────────────────────────────
    if (Array.isArray(body.sources)) {
      for (const src of body.sources) {
        const platform = typeof src === "string" ? src : src.platform;
        if (!platform) continue;
        db.insert(schema.contactSources)
          .values({
            id: crypto.randomUUID(),
            contactId,
            platform,
            externalId: typeof src === "object" ? src.externalId || null : null,
            connectedOn:
              typeof src === "object" ? src.connectedOn || null : null,
            rawData: typeof src === "object" ? src.rawData || null : null,
          })
          .run();
      }
    }

    // ── Interests ───────────────────────────────────────────────────────
    if (Array.isArray(body.interests)) {
      for (const item of body.interests) {
        const val = (typeof item === "string" ? item : item.interest)?.trim();
        if (!val) continue;
        const isAi =
          typeof item === "object" && item.isAiGenerated === true ? 1 : 0;
        sqlite
          .prepare(
            `
          INSERT INTO contact_interests (id, contactId, interest, isAiGenerated) 
          VALUES (?, ?, ?, ?) 
          ON CONFLICT(contactId, interest) DO UPDATE SET isAiGenerated = excluded.isAiGenerated
        `,
          )
          .run(crypto.randomUUID(), contactId, val, isAi);
      }
    }

    // ── Attributes ──────────────────────────────────────────────────────
    if (Array.isArray(body.attributes)) {
      for (const attr of body.attributes) {
        if (!attr?.name || !attr?.value) continue;
        sqlite
          .prepare(
            `
          INSERT INTO contact_attributes (id, contactId, name, value) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT(contactId, name) DO UPDATE SET value = excluded.value
        `,
          )
          .run(
            crypto.randomUUID(),
            contactId,
            attr.name.trim(),
            attr.value.trim(),
          );
      }
    }

    // ── Addresses ───────────────────────────────────────────────────────
    if (Array.isArray(body.addresses)) {
      for (let i = 0; i < body.addresses.length; i++) {
        const a = body.addresses[i];
        const address = (typeof a === "string" ? a : a.address)?.trim();
        if (!address) continue;
        sqlite
          .prepare(
            `
          INSERT INTO contact_addresses (id, contactId, address, label, isPrimary, sortOrder, source) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(contactId, address) DO UPDATE SET label = excluded.label, isPrimary = excluded.isPrimary, sortOrder = excluded.sortOrder
        `,
          )
          .run(
            crypto.randomUUID(),
            contactId,
            address,
            (typeof a === "object" ? a.label : "home") || "home",
            typeof a === "object" ? (a.isPrimary ? 1 : 0) : i === 0 ? 1 : 0,
            i,
            sourceName,
          );
      }
    }
  },

  // -------------------------------------------------------------------------
  // Granular Finders — for dedupe and other targeted queries
  // -------------------------------------------------------------------------

  findEmailsByContactId(contactId: string) {
    return stmts.emails.all(contactId) as Array<{
      id: string;
      email: string;
      label: string | null;
      isPrimary: number;
      source: string | null;
    }>;
  },

  findPhonesByContactId(contactId: string) {
    return stmts.phones.all(contactId) as Array<{
      id: string;
      phone: string;
      label: string | null;
      isPrimary: number;
      source: string | null;
    }>;
  },
};
