import crypto from "crypto";
import fs from "fs";
import path from "path";
import { resolveUploadPath } from "../utils/paths.ts";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import {
  contactRepo,
  RELATION_REGISTRY,
} from "../repositories/contactRepository.ts";
import type {
  ContactPayload,
  NewContactPayload,
  ContactRow,
  ChildRecordsPayload,
} from "../repositories/types.ts";
import { queueGeocode } from "./geocoding/index.ts";
import {
  processBase64Avatar,
  isBase64DataUri,
} from "../utils/avatarProcessor.ts";
import { aiCache } from "../utils/aiCache.ts";
import { buildContactUpdate } from "../utils/helpers.ts";
import { buildSmartAvatarUrl } from "../utils/smartAvatar.ts";
import {
  generateAndStoreEmbedding,
  generateAndStoreBulkEmbeddings,
} from "./dedupe/embeddings.ts";
import { embedContact } from "./search/localEmbeddings.ts";
import { generateSearchExpansion } from "../ai/aiService.ts";
import { doubleMetaphone } from "../utils/nlp/index.ts";
import { log } from "../utils/logger.ts";
import { dedupeService } from "./dedupe/index.ts";
import { getErrorMessage } from "../utils/helpers.ts";

// ---------------------------------------------------------------------------
// Incremental Dedupe — Debounce Map
// ---------------------------------------------------------------------------

/** Pending timers for incremental dedupe checks. */
const _dedupeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounce window for incremental checks (ms). */
const DEDUPE_DEBOUNCE_MS = 5_000;

/**
 * Fields that trigger search re-indexing (Doc2Query + local search embeddings)
 * when mutated. Defined once to prevent updateContact and patchContact diverging.
 */
const SEARCH_TRIGGER_FIELDS = [
  "name",
  "company",
  "role",
  "location",
  "industry",
  "headline",
  "about",
  "preferences",
] as const;

/**
 * Schedule a debounced incremental dedupe check for a contact.
 * If called multiple times for the same contact within 5s, only the last fires.
 */
function scheduleIncrementalDedupe(contactId: string) {
  // Integration tests set this to avoid 5s debounce timers outliving a file.
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  // Clear any pending timer
  const existing = _dedupeTimers.get(contactId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    _dedupeTimers.delete(contactId);
    const rid = crypto.randomUUID().slice(0, 8);
    dedupeService
      .incrementalDedupeCheck(contactId, rid)
      .catch((err) =>
        log.warn(
          "ContactService",
          `Incremental dedupe for ${contactId} failed: ${getErrorMessage(err)}`,
        ),
      );
  }, DEDUPE_DEBOUNCE_MS);

  _dedupeTimers.set(contactId, timer);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Map a contact body to the contacts-table insert values.
 * Centralised here so createContact + bulkCreateContacts stay DRY.
 * Any field not listed here will never reach the database.
 */
function buildInsertValues(body: NewContactPayload, id: string) {
  return {
    id,
    name: body.name,
    firstName: body.firstName || null,
    lastName: body.lastName || null,
    headline: body.headline || null,
    role: body.role || null,
    company: body.company || null,
    location: body.location || null,
    birthday: body.birthday || null,
    preferences: body.preferences || null,
    avatarUrl: body.avatarUrl || null,
    cadenceDays: body.cadenceDays ?? 90,
    about: body.about || null,
    pronouns: body.pronouns || null,
    industry: body.industry || null,
    website: body.website || null,
    phoneticHash: body.name ? doubleMetaphone(body.name).primary : null,
  };
}

/**
 * Invalidate the caches that depend on contact data.
 *
 * Deliberately NOT invalidateAll(): the content-addressed tiers (queryParse,
 * hyde, mentions) hash their own input text and are unaffected by contact
 * mutations — flushing them on every edit made repeat searches pay full AI
 * cost for nothing.
 */
function invalidateAllCaches() {
  aiCache.invalidate("rerank");
  aiCache.invalidate("synthesis");
  aiCache.invalidate("dailyInsight");
  aiCache.invalidate("briefing");
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Columns selected by the getSlimContacts Pass-1 query, typed off the schema. */
type SlimContactRow = Pick<
  ContactRow,
  | "id"
  | "name"
  | "firstName"
  | "lastName"
  | "company"
  | "avatarUrl"
  | "themeColor"
  | "isGhost"
  | "isArchived"
  | "addedAt"
  | "updatedAt"
  | "role"
  | "headline"
  | "location"
  | "industry"
  | "pronouns"
  | "cadenceDays"
  | "lastContactedAt"
  | "nextFollowUpAt"
  | "lat"
  | "lng"
  | "relationshipScore"
  | "aiHydratedAt"
>;

export const contactService = {
  createContact(body: NewContactPayload, source: string = "manual") {
    const id = crypto.randomUUID();
    const values = buildInsertValues(body, id);

    // Smart avatar: if no avatar was provided, generate a gender-aware one
    if (!values.avatarUrl && body.name) {
      values.avatarUrl = buildSmartAvatarUrl(body.name);
    }

    const txn = sqlite.transaction(() => {
      db.insert(schema.contacts).values(values).run();
      contactRepo.insertChildRecords(id, body, source);
    });
    txn();

    if (body.location) {
      queueGeocode(id, body.location);
    } else if (Array.isArray(body.addresses) && body.addresses.length > 0) {
      const primaryAddress =
        body.addresses.find(
          (a) => typeof a === "object" && a !== null && a.isPrimary,
        ) || body.addresses[0];
      const addressString =
        typeof primaryAddress === "string"
          ? primaryAddress
          : primaryAddress.address;
      if (addressString) queueGeocode(id, addressString);
    }

    // Fire-and-forget: generate embedding in the background
    generateAndStoreEmbedding(id).catch((err) =>
      log.warn(
        "ContactService",
        `Background embedding for ${id} failed: ${getErrorMessage(err)}`,
      ),
    );

    // Fire-and-forget: Doc2Query search expansion → then embed with complete data
    // NOTE: We intentionally don't embed before expansion completes — the single
    // embedContact call after expansion captures the enriched text, avoiding a
    // double-embed race condition.
    generateSearchExpansion({
      name: body.name,
      role: body.role,
      company: body.company,
      industry: body.industry,
      about: body.about,
      preferences: body.preferences,
      tags: body.tags?.map((t) => (typeof t === "string" ? t : t.tag)),
      interests: body.interests?.map((i) =>
        typeof i === "string" ? i : i.interest,
      ),
    })
      .then((expansion) => {
        if (expansion) {
          sqlite
            .prepare("UPDATE contacts SET searchExpansion = ? WHERE id = ?")
            .run(expansion, id);
        }
        // Embed with or without expansion — this is the definitive embedding
        return embedContact(id);
      })
      .catch((err) =>
        log.debug(
          "ContactService",
          `Doc2Query/embed for ${id} skipped: ${err?.message}`,
        ),
      );

    // Fire-and-forget: incremental dedupe check (debounced)
    scheduleIncrementalDedupe(id);

    invalidateAllCaches();
    return contactRepo.hydrate(
      sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id),
    );
  },

  async bulkCreateContacts(
    validContacts: NewContactPayload[],
    onProgress?: (processed: number, total: number, phase: string) => void,
  ): Promise<{ count: number; createdIds: string[] }> {
    const total = validContacts.length;

    // Phase 1: Process base64 data-URI avatars (from VCF imports) into optimized files
    // This runs before the SQLite transaction since sharp is async
    for (let i = 0; i < validContacts.length; i++) {
      const c = validContacts[i];
      if (isBase64DataUri(c.avatarUrl)) {
        const fileUrl = await processBase64Avatar(c.avatarUrl);
        c.avatarUrl = fileUrl; // null if processing failed; smart avatar fallback below
      }
      onProgress?.(i + 1, total, "Processing images");
    }

    // Phase 2: Insert all contacts into SQLite in a single transaction
    // Batch mode: defer all cache invalidations until the transaction completes.
    // Without this, each contact insert triggers a full cache flush (N flushes
    // for N contacts). With batch mode, exactly 1 flush after all inserts.
    aiCache.enterBatchMode();
    let count = 0;
    const createdIds: string[] = [];
    try {
      const txn = sqlite.transaction(() => {
        for (const c of validContacts) {
          const id = crypto.randomUUID();
          const values = buildInsertValues(c, id);

          // Smart avatar: gender-aware DiceBear URL if no avatar was provided
          if (!values.avatarUrl && c.name) {
            values.avatarUrl = buildSmartAvatarUrl(c.name);
          }

          db.insert(schema.contacts).values(values).run();
          contactRepo.insertChildRecords(id, c, c._sourcePlatform || "manual");
          if (c.location) queueGeocode(id, c.location);
          createdIds.push(id);
          count++;
        }
      });
      txn();
      onProgress?.(total, total, "Complete");

      invalidateAllCaches();
    } finally {
      aiCache.exitBatchMode();
    }
    return { count, createdIds };
  },

  bulkDeleteContacts(ids: string[]) {
    aiCache.enterBatchMode();
    try {
      const deleteFn = sqlite.transaction(() => {
        const stmt = sqlite.prepare("DELETE FROM contacts WHERE id = ?");
        // vec0 tables don't support FK cascading — clean up manually
        const delSearch = sqlite.prepare(
          "DELETE FROM search_embeddings WHERE contactId = ?",
        );
        const delDedupe = sqlite.prepare(
          "DELETE FROM contact_embeddings WHERE contactId = ?",
        );
        // Regular table, but not FK-linked to contacts — clean up so
        // findStaleEmbeddings() doesn't drift on orphaned metadata.
        const delMeta = sqlite.prepare(
          "DELETE FROM dedupe_embedding_meta WHERE contactId = ?",
        );
        for (const id of ids) {
          try {
            delSearch.run(id);
          } catch {
            /* vec0 row may not exist */
          }
          try {
            delDedupe.run(id);
          } catch {
            /* vec0 row may not exist */
          }
          delMeta.run(id);
          stmt.run(id);
        }
      });
      deleteFn();
      invalidateAllCaches();
    } finally {
      aiCache.exitBatchMode();
    }
    return ids.length;
  },

  bulkUpdateContacts(ids: string[], data: Record<string, unknown>) {
    aiCache.enterBatchMode();
    try {
      const update = buildContactUpdate(data);
      // Safety: buildContactUpdate returns only keys from a hardcoded whitelist
      // (see utils/helpers.ts). Interpolating those key names into SQL is safe
      // because no user-supplied string reaches the SET clause — only column names.
      const updateFn = sqlite.transaction(() => {
        const setClauses = Object.keys(update)
          .map((k) => `${k} = ?`)
          .join(", ");
        const values = Object.values(update);
        const stmt = sqlite.prepare(
          `UPDATE contacts SET ${setClauses} WHERE id = ?`,
        );
        for (const id of ids) stmt.run(...values, id);
      });
      updateFn();
      invalidateAllCaches();
    } finally {
      aiCache.exitBatchMode();
    }
    return ids.length;
  },

  updateContact(id: string, body: ContactPayload) {
    // Recompute phoneticHash if name changed
    const updateData = buildContactUpdate(body);
    if (body.name) {
      updateData.phoneticHash = doubleMetaphone(body.name).primary;
    }

    const txn = sqlite.transaction(() => {
      db.update(schema.contacts)
        .set(updateData)
        .where(eq(schema.contacts.id, id))
        .run();

      for (const [bodyKey, config] of Object.entries(RELATION_REGISTRY)) {
        const key = bodyKey as keyof typeof RELATION_REGISTRY;
        if (body[key] !== undefined && Array.isArray(body[key])) {
          sqlite
            .prepare(`DELETE FROM ${config.dbName} WHERE contactId = ?`)
            .run(id);
          contactRepo.insertChildRecords(id, {
            [key]: body[key],
          } as ChildRecordsPayload);
        }
      }
    });
    txn();

    const updated = contactRepo.hydrate(
      sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id),
    );
    if (!updated) return null;

    if (body.location) {
      queueGeocode(id, body.location);
    } else if (Array.isArray(body.addresses) && body.addresses.length > 0) {
      const primaryAddress =
        body.addresses.find(
          (a) => typeof a === "object" && a !== null && a.isPrimary,
        ) || body.addresses[0];
      const addressString =
        typeof primaryAddress === "string"
          ? primaryAddress
          : primaryAddress.address;
      if (addressString) queueGeocode(id, addressString);
    }

    // Fire-and-forget: recompute embedding if key fields changed
    const embeddingFields = [
      "name",
      "company",
      "role",
      "location",
      "industry",
      "headline",
    ];
    if (embeddingFields.some((f) => body[f] !== undefined)) {
      generateAndStoreEmbedding(id).catch((err) =>
        log.warn(
          "ContactService",
          `Background embedding update for ${id} failed: ${getErrorMessage(err)}`,
        ),
      );
    }

    // Fire-and-forget: recompute search embedding + Doc2Query
    if (SEARCH_TRIGGER_FIELDS.some((f) => body[f] !== undefined)) {
      // Regenerate Doc2Query expansion → then embed once with complete data
      const row = sqlite
        .prepare(
          "SELECT name, role, company, industry, about, preferences FROM contacts WHERE id = ?",
        )
        .get(id) as
        | Pick<
            ContactRow,
            "name" | "role" | "company" | "industry" | "about" | "preferences"
          >
        | undefined;
      if (row) {
        const tags = (
          sqlite
            .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
            .all(id) as { tag: string }[]
        ).map((t) => t.tag);
        const interests = (
          sqlite
            .prepare(
              "SELECT interest FROM contact_interests WHERE contactId = ?",
            )
            .all(id) as { interest: string }[]
        ).map((t) => t.interest);
        generateSearchExpansion({ ...row, tags, interests })
          .then((expansion) => {
            if (expansion) {
              sqlite
                .prepare("UPDATE contacts SET searchExpansion = ? WHERE id = ?")
                .run(expansion, id);
            }
            return embedContact(id);
          })
          .catch((err) =>
            log.debug(
              "ContactService",
              `Doc2Query/embed update for ${id} skipped: ${err?.message}`,
            ),
          );
      } else {
        embedContact(id).catch(() => {});
      }
    }

    // Fire-and-forget: incremental dedupe if identity fields changed
    const dedupeFields = [
      "name",
      "firstName",
      "lastName",
      "company",
      "role",
      "location",
    ];
    if (dedupeFields.some((f) => body[f] !== undefined)) {
      scheduleIncrementalDedupe(id);
    }

    invalidateAllCaches();
    return updated;
  },

  patchContact(id: string, body: Record<string, unknown>) {
    const update = buildContactUpdate(body);
    db.update(schema.contacts)
      .set(update)
      .where(eq(schema.contacts.id, id))
      .run();

    if (typeof body.location === "string" && body.location) {
      queueGeocode(id, body.location);
    }

    // Fire-and-forget: recompute search embedding if searchable fields changed
    // NOTE: FTS5 is already updated by the contacts_au trigger, but the
    // vector embedding + Doc2Query expansion must be refreshed explicitly.
    if (SEARCH_TRIGGER_FIELDS.some((f) => body[f] !== undefined)) {
      embedContact(id).catch(() => {});
    }

    const updated = contactRepo.hydrate(
      sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id),
    );
    if (!updated) return null;

    invalidateAllCaches();
    return updated;
  },

  deleteContact(id: string) {
    // vec0 tables don't support FK cascading — clean up manually before delete
    try {
      sqlite
        .prepare("DELETE FROM search_embeddings WHERE contactId = ?")
        .run(id);
    } catch {
      /* vec0 row may not exist */
    }
    try {
      sqlite
        .prepare("DELETE FROM contact_embeddings WHERE contactId = ?")
        .run(id);
    } catch {
      /* vec0 row may not exist */
    }
    // Keep dedupe embedding metadata in sync (not FK-linked to contacts).
    sqlite
      .prepare("DELETE FROM dedupe_embedding_meta WHERE contactId = ?")
      .run(id);

    const result = db
      .delete(schema.contacts)
      .where(eq(schema.contacts.id, id))
      .returning()
      .get();
    if (!result) return false;
    invalidateAllCaches();
    return true;
  },

  updateAvatar(id: string, fileFilename: string, fileOriginalName: string) {
    const avatarUrl = `/uploads/avatars/${fileFilename}`;

    const existing = sqlite
      .prepare("SELECT avatarUrl FROM contacts WHERE id = ?")
      .get(id) as { avatarUrl: string | null } | undefined;
    if (existing?.avatarUrl?.startsWith("/uploads/avatars/")) {
      // avatarUrl is user-writable via the update endpoints — resolve it
      // through the containment check so `..` segments can't escape uploads/.
      const oldPath = resolveUploadPath(existing.avatarUrl);
      if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    db.update(schema.contacts)
      .set({ avatarUrl, updatedAt: new Date().toISOString() })
      .where(eq(schema.contacts.id, id))
      .run();

    const updated = contactRepo.hydrate(
      sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id),
    );
    if (!updated) return null;

    invalidateAllCaches();
    return updated;
  },

  getMapContacts() {
    return sqlite
      .prepare(
        "SELECT id, name, company, avatarUrl, location, lat, lng FROM contacts WHERE lat IS NOT NULL AND lng IS NOT NULL AND (isArchived = 0 OR isArchived IS NULL)",
      )
      .all();
  },

  getArchivedContacts() {
    const all = sqlite
      .prepare(
        "SELECT * FROM contacts WHERE isArchived = 1 ORDER BY updatedAt DESC",
      )
      .all();
    return contactRepo.hydrateMany(all);
  },

  getSlimContacts() {
    const startMs = Date.now();

    // Pass 1: Primary contact data (Fast indexed SELECT)
    const rows = sqlite
      .prepare(
        `
      SELECT id, name, firstName, lastName, company, avatarUrl, 
             themeColor, isGhost, isArchived, addedAt, updatedAt,
             role, headline, location, industry, pronouns,
             cadenceDays, lastContactedAt, nextFollowUpAt,
             lat, lng, relationshipScore, aiHydratedAt
      FROM contacts
      WHERE (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL
      ORDER BY addedAt DESC
    `,
      )
      .all() as SlimContactRow[];
    const pass1Ms = Date.now() - startMs;

    // Pass 2: Batch fetch all relations (Separate queries are faster than GROUP_CONCAT/LEFT JOIN for large sets)
    const listStartMs = Date.now();
    const listRows = sqlite
      .prepare(
        `
      SELECT lm.contactId, l.id, l.name, l.icon, l.sortOrder
      FROM list_members lm
      JOIN lists l ON l.id = lm.listId
      WHERE lm.contactId IN (SELECT id FROM contacts WHERE isArchived = 0 OR isArchived IS NULL)
      ORDER BY l.sortOrder ASC
    `,
      )
      .all() as {
      contactId: string;
      id: string;
      name: string;
      icon: string | null;
      sortOrder: number;
    }[];

    const unarchivedQuery = `WHERE contactId IN (SELECT id FROM contacts WHERE isArchived = 0 OR isArchived IS NULL)`;
    const tagRows = sqlite
      .prepare(`SELECT contactId, tag FROM contact_tags ${unarchivedQuery}`)
      .all() as { contactId: string; tag: string }[];
    const emailRows = sqlite
      .prepare(`SELECT contactId, email FROM contact_emails ${unarchivedQuery}`)
      .all() as { contactId: string; email: string }[];
    const phoneRows = sqlite
      .prepare(`SELECT contactId, phone FROM contact_phones ${unarchivedQuery}`)
      .all() as { contactId: string; phone: string }[];
    const interactionCounts = sqlite
      .prepare(
        `SELECT contactId, COUNT(*) as cnt FROM interactions ${unarchivedQuery} GROUP BY contactId`,
      )
      .all() as { contactId: string; cnt: number }[];
    const socialLinkCounts = sqlite
      .prepare(
        `SELECT contactId, COUNT(*) as cnt FROM contact_social_links ${unarchivedQuery} GROUP BY contactId`,
      )
      .all() as { contactId: string; cnt: number }[];
    const pass2Ms = Date.now() - listStartMs;

    // Pass 3: Join in JS (Near-zero cost O(N))
    const joinStartMs = Date.now();
    const listsByContact = new Map<
      string,
      { id: string; name: string; icon: string | null; sortOrder: number }[]
    >();
    for (const r of listRows) {
      if (!listsByContact.has(r.contactId)) listsByContact.set(r.contactId, []);
      listsByContact
        .get(r.contactId)!
        .push({ id: r.id, name: r.name, icon: r.icon, sortOrder: r.sortOrder });
    }

    const tagsByContact = new Map<string, { id: string; tag: string }[]>();
    for (const r of tagRows) {
      if (!tagsByContact.has(r.contactId)) tagsByContact.set(r.contactId, []);
      tagsByContact.get(r.contactId)!.push({ id: r.tag, tag: r.tag });
    }

    const emailsByContact = new Map<string, { email: string }[]>();
    for (const r of emailRows) {
      if (!emailsByContact.has(r.contactId))
        emailsByContact.set(r.contactId, []);
      emailsByContact.get(r.contactId)!.push({ email: r.email });
    }

    const phonesByContact = new Map<string, { phone: string }[]>();
    for (const r of phoneRows) {
      if (!phonesByContact.has(r.contactId))
        phonesByContact.set(r.contactId, []);
      phonesByContact.get(r.contactId)!.push({ phone: r.phone });
    }

    const interactionMap = new Map(
      interactionCounts.map((r) => [r.contactId, r.cnt]),
    );
    const socialLinkMap = new Map(
      socialLinkCounts.map((r) => [r.contactId, r.cnt]),
    );

    const results = rows.map((r) => ({
      ...r,
      isGhost: !!r.isGhost,
      isArchived: !!r.isArchived,
      tags: tagsByContact.get(r.id) || [],
      lists: listsByContact.get(r.id) || [],
      interactionCount: interactionMap.get(r.id) || 0,
      emails: emailsByContact.get(r.id) || [],
      phones: phonesByContact.get(r.id) || [],
      socialLinkCount: socialLinkMap.get(r.id) || 0,
      // Fixed arrays for slim view compatibility
      socialLinks: [],
      education: [],
      experience: [],
      sources: [],
      addresses: [],
      interests: [],
      attributes: [],
    }));
    const joinMs = Date.now() - joinStartMs;

    log.info(
      "Perf",
      `getSlimContacts: total=${Date.now() - startMs}ms (sql_base=${pass1Ms}ms, sql_batch=${pass2Ms}ms, js_join=${joinMs}ms) n=${rows.length}`,
    );
    return results;
  },

  getAllContacts() {
    const all = sqlite
      .prepare(
        "SELECT * FROM contacts WHERE (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL ORDER BY addedAt DESC",
      )
      .all();
    return contactRepo.hydrateMany(all);
  },

  getContactById(id: string) {
    const contact = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(id);
    if (!contact) return null;
    return contactRepo.hydrate(contact);
  },
};
