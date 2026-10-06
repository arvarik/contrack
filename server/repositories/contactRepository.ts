// Typed data access for contacts and their child tables: hydration and
// persistence in one class. Reads use prepared statements, writes use Drizzle
// insert() for type-safe columns, and SQLite 0/1 becomes a boolean in one
// place.

import { sqlite, db } from "../db.ts";
import * as schema from "../db/schema.ts";
import type { Scope } from "../tenancy/scope.ts";
import { NotFoundError } from "../utils/AppError.ts";

import crypto from "crypto";
import type { HydratedContact, ChildRecordsPayload } from "./types.ts";

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

// URL utilities for social links

/**
 * The domains each known platform answers on. A link's host is one of these
 * or a subdomain of one ("uk.linkedin.com", "m.facebook.com").
 */
const PLATFORM_DOMAINS: readonly (readonly [string, readonly string[]])[] = [
  ["linkedin", ["linkedin.com"]],
  ["facebook", ["facebook.com", "fb.com"]],
  ["twitter", ["twitter.com", "x.com"]],
  ["github", ["github.com"]],
  ["instagram", ["instagram.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
];

/**
 * The platform a social link belongs to, from its host: "linkedin", "twitter",
 * "youtube", or "other".
 *
 * It reads the host, not the whole URL text, with `www.` off, and matches the
 * domain itself or a subdomain, so dropbox.com is not "x.com", "notgithub.com"
 * is not "github.com", and a LinkedIn URL in a query string does not make a
 * link "linkedin". A link with no scheme ("www.linkedin.com/in/ada", as vCards
 * and CSVs often have it) is read as https, so an import keeps its platforms.
 * Text that is not a URL is "other".
 *
 * Exported for `tests/unit/server/repositories/detectPlatform.test.ts`.
 */
export function detectPlatformFromUrl(url: string): string {
  const text = url.trim();
  // A scheme is letters before the first colon, with no dot: "example.com:8080"
  // is a host and a port.
  const withScheme = /^[a-z][a-z\d+-]*:/i.test(text) ? text : `https://${text}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
  for (const [platform, domains] of PLATFORM_DOMAINS) {
    if (domains.some((d) => host === d || host.endsWith(`.${d}`))) {
      return platform;
    }
  }
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
 * Services that are shut down for good, so every link to them is dead. A list,
 * not an HTTP check, keeps import instant and offline.
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

// Hydration statements, compiled once at module load.

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
    // tenant-lint: allow owner-checked by caller
    `SELECT l.id, l.name, l.icon FROM lists l
     JOIN list_members lm ON l.id = lm.listId
     WHERE lm.contactId = ?
     ORDER BY l.sortOrder ASC`,
  ),
  interactionCount: sqlite.prepare(
    // tenant-lint: allow owner-checked by caller
    "SELECT COUNT(*) as cnt FROM interactions WHERE contactId = ?",
  ),
};

/**
 * A raw contact row from better-sqlite3. Loose on purpose: callers select
 * different columns (slim view, full select, dedupe engine), and only `id` is
 * needed for child-table joins. Drizzle's InferSelectModel is stricter than
 * what better-sqlite3 returns (numbers for booleans, for one).
 */
export type RawContactRow = Record<string, unknown> & { id: string };

/**
 * The scoped finders. Every read of a contact by a client-supplied id goes
 * through one of these. Each puts the id and the owner in the same statement:
 * one index probe, and no window in which the row is read before the owner is
 * checked. The primary key and `idx_contacts_owner_status` both start with a
 * column these predicates pin, so the extra term costs nothing measurable.
 */
const finders = {
  byId: sqlite.prepare("SELECT * FROM contacts WHERE id = ? AND ownerId = ?"),
  byIdActive: sqlite.prepare(
    "SELECT * FROM contacts WHERE id = ? AND ownerId = ? AND deletedAt IS NULL",
  ),
};

/** Same chunk as hydrateMany, and far under SQLite's bound-parameter limit. */
const FIND_MANY_CHUNK = 500;

export const contactRepo = {
  // Scoped finders: the owner and the id in one statement

  /** One contact the scope owns, trashed or not, or null. */
  findOwned(scope: Scope, id: string): RawContactRow | null {
    return (finders.byId.get(id, scope.ownerId) as RawContactRow) ?? null;
  },

  /** One contact the scope owns that is not in the trash, or null. */
  findOwnedActive(scope: Scope, id: string): RawContactRow | null {
    return (finders.byIdActive.get(id, scope.ownerId) as RawContactRow) ?? null;
  },

  /**
   * The subset of `ids` the scope owns, in no particular order. Bulk endpoints
   * drop foreign ids with it first, so the count they report is the rows they
   * changed. Duplicate ids collapse.
   */
  findManyOwned(scope: Scope, ids: string[]): RawContactRow[] {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows: RawContactRow[] = [];
    for (let i = 0; i < unique.length; i += FIND_MANY_CHUNK) {
      const chunk = unique.slice(i, i + FIND_MANY_CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      rows.push(
        ...(sqlite
          .prepare(
            `SELECT * FROM contacts WHERE ownerId = ? AND id IN (${placeholders})`,
          )
          .all(scope.ownerId, chunk) as RawContactRow[]),
      );
    }
    return rows;
  },

  /**
   * One contact the scope owns, or a 404. The error carries no id and no
   * reason, so "no such contact" and "not yours" look alike and the 404 is no
   * existence oracle.
   */
  requireOwned(scope: Scope, id: string): RawContactRow {
    const row = contactRepo.findOwned(scope, id);
    if (!row) throw new NotFoundError("Contact");
    return row;
  },

  // Hydration (read side)

  /**
   * Hydrate one raw contact row into the full API shape: all 10 child tables,
   * list memberships and the interaction count. Takes `unknown`, as
   * `sqlite.prepare().get()` returns, and narrows it.
   *
   * @param contact - A raw row from the contacts table, or
   *   null/undefined/unknown
   * @returns Fully hydrated contact with typed child arrays, or null
   */
  hydrate(contact: unknown): HydratedContact | null {
    if (!contact || typeof contact !== "object" || !("id" in contact))
      return null;
    const row = contact as RawContactRow;

    return {
      ...row,
      isGhost: !!row.isGhost,
      isArchived: !!row.isArchived,
      isTracked: !!row.isTracked,
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
   * Hydrate many contact rows with chunked batch queries, not N+1.
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
      // tenant-lint: allow owner-checked by caller
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
      // tenant-lint: allow owner-checked by caller
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
          isGhost: !!row.isGhost,
          isArchived: !!row.isArchived,
          isTracked: !!row.isTracked,
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

  // Child records (write side)

  /**
   * Insert a contact's child records (emails, phones, tags and the rest),
   * normalizing the string-or-object inputs into typed inserts. All ten tables
   * are written in one transaction, so a failed insert (a foreign key, a UNIQUE
   * conflict) never leaves a contact with part of its rows.
   *
   * @param contactId - Foreign key UUID of the parent contact
   * @param body - Payload containing arrays of child record objects
   * @param sourceName - Origin stamp for provenance tracking (default:
   *   'manual')
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
   * INTERNAL: the caller must hold an open transaction. For
   * `insertChildRecords`, which opens its own, and for services already inside
   * a wider one (bulk import), where a nested transaction would fail.
   */
  _insertChildRecordsUnsafe(
    contactId: string,
    body: ChildRecordsPayload,
    sourceName = "manual",
  ): void {
    // Emails
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

    // Phones
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

    // Social Links
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

    // Education
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

    // Experience
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

    // Tags: one row per tag whatever its case ("dup", "dup" and "Dup" are one
    // tag, spelled as it came first). A unique index would need existing
    // repeats cleaned up first, so the write dedupes instead.
    if (Array.isArray(body.tags)) {
      const seen = new Set(
        (
          sqlite
            .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
            .pluck()
            .all(contactId) as string[]
        ).map((tag) => tag.toLowerCase()),
      );
      for (const tag of body.tags) {
        const val = (typeof tag === "string" ? tag : tag.tag)?.trim();
        if (!val || seen.has(val.toLowerCase())) continue;
        seen.add(val.toLowerCase());
        db.insert(schema.contactTags)
          .values({
            id: crypto.randomUUID(),
            contactId,
            tag: val,
          })
          .run();
      }
    }

    // Sources
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

    // Interests
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

    // Attributes
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

    // Addresses
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
};
