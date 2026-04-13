import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { contactRepo } from "../repositories/contactRepository.ts";
import { queueGeocode } from "./geocoding/index.ts";
import { processBase64Avatar, isBase64DataUri } from "../utils/avatarProcessor.ts";
import { invalidateSearchCache } from "../utils/searchCache.ts";
import { invalidateDailyInsight } from "./dashboardService.ts";
import { aiCache } from "../utils/aiCache.ts";
import { buildContactUpdate } from "../utils/helpers.ts";
import { buildSmartAvatarUrl } from "../utils/smartAvatar.ts";
import { generateAndStoreEmbedding, generateAndStoreBulkEmbeddings } from "./dedupe/embeddings.ts";
import { embedContact } from "./search/localEmbeddings.ts";
import { generateSearchExpansion } from "../ai/aiService.ts";
import { doubleMetaphone } from "../utils/nlp/index.ts";
import { log } from "../utils/logger.ts";
import { dedupeService, dedupeQueue } from "./dedupe/index.ts";
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
  'name', 'company', 'role', 'location', 'industry', 'headline', 'about', 'preferences',
] as const;

/**
 * Schedule a debounced incremental dedupe check for a contact.
 * If called multiple times for the same contact within 5s, only the last fires.
 */
function scheduleIncrementalDedupe(contactId: string) {
  // Clear any pending timer
  const existing = _dedupeTimers.get(contactId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    _dedupeTimers.delete(contactId);
    const rid = crypto.randomUUID().slice(0, 8);
    dedupeService.incrementalDedupeCheck(contactId, rid).catch(err =>
      log.warn("ContactService", `Incremental dedupe for ${contactId} failed: ${getErrorMessage(err)}`)
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
function buildInsertValues(body: any, id: string) {
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

/** Invalidate all caches that depend on contact data. */
function invalidateAllCaches() {
  // aiCache.invalidateAll() flushes all tiers (rerank, synthesis, dailyInsight,
  // briefing). This is a single call that replaces the former two-call pattern
  // (invalidateSearchCache + invalidateDailyInsight).
  aiCache.invalidateAll();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const contactService = {
  createContact(body: any, source: string = 'manual') {
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
      const primaryAddress = body.addresses.find((a: any) => a?.isPrimary) || body.addresses[0];
      const addressString = typeof primaryAddress === 'string' ? primaryAddress : primaryAddress.address;
      if (addressString) queueGeocode(id, addressString);
    }

    // Fire-and-forget: generate embedding in the background
    generateAndStoreEmbedding(id).catch(err =>
      log.warn("ContactService", `Background embedding for ${id} failed: ${getErrorMessage(err)}`)
    );

    // Fire-and-forget: Doc2Query search expansion → then embed with complete data
    // NOTE: We intentionally don't embed before expansion completes — the single
    // embedContact call after expansion captures the enriched text, avoiding a
    // double-embed race condition.
    generateSearchExpansion({
      name: body.name, role: body.role, company: body.company,
      industry: body.industry, about: body.about, preferences: body.preferences,
      tags: body.tags, interests: body.interests,
    }).then(expansion => {
      if (expansion) {
        sqlite.prepare("UPDATE contacts SET searchExpansion = ? WHERE id = ?").run(expansion, id);
      }
      // Embed with or without expansion — this is the definitive embedding
      return embedContact(id);
    }).catch(err =>
      log.debug("ContactService", `Doc2Query/embed for ${id} skipped: ${err?.message}`)
    );

    // Fire-and-forget: incremental dedupe check (debounced)
    scheduleIncrementalDedupe(id);

    invalidateAllCaches();
    return contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
  },

  async bulkCreateContacts(
    validContacts: any[],
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
      onProgress?.(i + 1, total, 'Processing images');
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
          contactRepo.insertChildRecords(id, c, c._sourcePlatform || 'manual');
          if (c.location) queueGeocode(id, c.location);
          createdIds.push(id);
          count++;
        }
      });
      txn();
      onProgress?.(total, total, 'Complete');

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
        const delSearch = sqlite.prepare("DELETE FROM search_embeddings WHERE contactId = ?");
        const delDedupe = sqlite.prepare("DELETE FROM contact_embeddings WHERE contactId = ?");
        for (const id of ids) {
          try { delSearch.run(id); } catch { /* vec0 row may not exist */ }
          try { delDedupe.run(id); } catch { /* vec0 row may not exist */ }
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

  bulkUpdateContacts(ids: string[], data: any) {
    aiCache.enterBatchMode();
    try {
      const update = buildContactUpdate(data);
      // Safety: buildContactUpdate returns only keys from a hardcoded whitelist
      // (see utils/helpers.ts). Interpolating those key names into SQL is safe
      // because no user-supplied string reaches the SET clause — only column names.
      const updateFn = sqlite.transaction(() => {
        const setClauses = Object.keys(update).map(k => `${k} = ?`).join(', ');
        const values = Object.values(update);
        const stmt = sqlite.prepare(`UPDATE contacts SET ${setClauses} WHERE id = ?`);
        for (const id of ids) stmt.run(...values, id);
      });
      updateFn();
      invalidateAllCaches();
    } finally {
      aiCache.exitBatchMode();
    }
    return ids.length;
  },

  updateContact(id: string, body: any) {
    // Recompute phoneticHash if name changed
    const updateData = buildContactUpdate(body);
    if (body.name) {
      (updateData as any).phoneticHash = doubleMetaphone(body.name).primary;
    }

    const txn = sqlite.transaction(() => {
      db.update(schema.contacts).set(updateData).where(eq(schema.contacts.id, id)).run();

      const childMappings: [keyof typeof body, string][] = [
        ['emails', 'contact_emails'],
        ['phones', 'contact_phones'],
        ['socialLinks', 'contact_social_links'],
        ['tags', 'contact_tags'],
        ['interests', 'contact_interests'],
        ['addresses', 'contact_addresses'],
        ['attributes', 'contact_attributes'],
        ['education', 'contact_education'],
        ['experience', 'contact_experience'],
        ['sources', 'contact_sources'],
      ];

      for (const [bodyKey, tableName] of childMappings) {
        if (body[bodyKey] !== undefined && Array.isArray(body[bodyKey])) {
          sqlite.prepare(`DELETE FROM ${tableName} WHERE contactId = ?`).run(id);
          contactRepo.insertChildRecords(id, { [bodyKey]: body[bodyKey] });
        }
      }
    });
    txn();

    const updated = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
    if (!updated) return null;

    if (body.location) {
      queueGeocode(id, body.location);
    } else if (Array.isArray(body.addresses) && body.addresses.length > 0) {
      const primaryAddress = body.addresses.find((a: any) => a?.isPrimary) || body.addresses[0];
      const addressString = typeof primaryAddress === 'string' ? primaryAddress : primaryAddress.address;
      if (addressString) queueGeocode(id, addressString);
    }

    // Fire-and-forget: recompute embedding if key fields changed
    const embeddingFields = ['name', 'company', 'role', 'location', 'industry', 'headline'];
    if (embeddingFields.some(f => body[f] !== undefined)) {
      generateAndStoreEmbedding(id).catch(err =>
        log.warn("ContactService", `Background embedding update for ${id} failed: ${getErrorMessage(err)}`)
      );
    }

    // Fire-and-forget: recompute search embedding + Doc2Query
    if (SEARCH_TRIGGER_FIELDS.some(f => body[f] !== undefined)) {
      // Regenerate Doc2Query expansion → then embed once with complete data
      const row = sqlite.prepare("SELECT name, role, company, industry, about, preferences FROM contacts WHERE id = ?").get(id) as any;
      if (row) {
        const tags = (sqlite.prepare("SELECT tag FROM contact_tags WHERE contactId = ?").all(id) as { tag: string }[]).map(t => t.tag);
        const interests = (sqlite.prepare("SELECT interest FROM contact_interests WHERE contactId = ?").all(id) as { interest: string }[]).map(t => t.interest);
        generateSearchExpansion({ ...row, tags, interests }).then(expansion => {
          if (expansion) {
            sqlite.prepare("UPDATE contacts SET searchExpansion = ? WHERE id = ?").run(expansion, id);
          }
          return embedContact(id);
        }).catch(err =>
          log.debug("ContactService", `Doc2Query/embed update for ${id} skipped: ${err?.message}`)
        );
      } else {
        embedContact(id).catch(() => {});
      }
    }

    // Fire-and-forget: incremental dedupe if identity fields changed
    const dedupeFields = ['name', 'firstName', 'lastName', 'company', 'role', 'location'];
    if (dedupeFields.some(f => body[f] !== undefined)) {
      scheduleIncrementalDedupe(id);
    }

    invalidateAllCaches();
    return updated;
  },

  patchContact(id: string, body: any) {
    const update = buildContactUpdate(body);
    db.update(schema.contacts).set(update).where(eq(schema.contacts.id, id)).run();

    if (body.location) {
      queueGeocode(id, body.location);
    }

    // Fire-and-forget: recompute search embedding if searchable fields changed
    // NOTE: FTS5 is already updated by the contacts_au trigger, but the
    // vector embedding + Doc2Query expansion must be refreshed explicitly.
    if (SEARCH_TRIGGER_FIELDS.some(f => body[f] !== undefined)) {
      embedContact(id).catch(() => {});
    }

    const updated = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
    if (!updated) return null;

    invalidateAllCaches();
    return updated;
  },

  deleteContact(id: string) {
    // vec0 tables don't support FK cascading — clean up manually before delete
    try { sqlite.prepare("DELETE FROM search_embeddings WHERE contactId = ?").run(id); } catch { /* vec0 row may not exist */ }
    try { sqlite.prepare("DELETE FROM contact_embeddings WHERE contactId = ?").run(id); } catch { /* vec0 row may not exist */ }

    const result = db.delete(schema.contacts).where(eq(schema.contacts.id, id)).returning().get();
    if (!result) return false;
    invalidateAllCaches();
    return true;
  },

  updateAvatar(id: string, fileFilename: string, fileOriginalName: string) {
    const avatarUrl = `/uploads/avatars/${fileFilename}`;

    const existing = sqlite.prepare("SELECT avatarUrl FROM contacts WHERE id = ?").get(id) as any;
    if (existing?.avatarUrl?.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(process.cwd(), existing.avatarUrl);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    db.update(schema.contacts)
      .set({ avatarUrl, updatedAt: new Date().toISOString() })
      .where(eq(schema.contacts.id, id))
      .run();

    const updated = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
    if (!updated) return null;

    invalidateAllCaches();
    return updated;
  },

  getMapContacts() {
    return sqlite.prepare(
      "SELECT id, name, company, avatarUrl, location, lat, lng FROM contacts WHERE lat IS NOT NULL AND lng IS NOT NULL AND (isArchived = 0 OR isArchived IS NULL)"
    ).all();
  },

  getArchivedContacts() {
    const all = sqlite.prepare("SELECT * FROM contacts WHERE isArchived = 1 ORDER BY updatedAt DESC").all();
    return contactRepo.hydrateMany(all);
  },

  getSlimContacts() {
    const rows = sqlite.prepare(`
      SELECT c.id, c.name, c.firstName, c.lastName, c.company, c.avatarUrl, 
             c.themeColor, c.isGhost, c.isArchived, c.addedAt, c.updatedAt,
             c.role, c.headline, c.location, c.industry, c.pronouns,
             c.cadenceDays, c.lastContactedAt, c.nextFollowUpAt,
             c.lat, c.lng, c.relationshipScore, c.aiHydratedAt,
             GROUP_CONCAT(DISTINCT t.tag) as _tags,
             (SELECT COUNT(*) FROM interactions WHERE contactId = c.id) as interactionCount,
             (SELECT GROUP_CONCAT(e.email) FROM contact_emails e WHERE e.contactId = c.id) as _allEmails,
             (SELECT GROUP_CONCAT(p.phone) FROM contact_phones p WHERE p.contactId = c.id) as _allPhones,
             (SELECT COUNT(*) FROM contact_social_links sl WHERE sl.contactId = c.id) as socialLinkCount
      FROM contacts c
      LEFT JOIN contact_tags t ON c.id = t.contactId
      WHERE (c.isArchived = 0 OR c.isArchived IS NULL)
      GROUP BY c.id
      ORDER BY c.addedAt DESC
    `).all() as any[];

    const listRows = sqlite.prepare(`
      SELECT lm.contactId, l.id, l.name, l.icon, l.sortOrder
      FROM list_members lm
      JOIN lists l ON l.id = lm.listId
      ORDER BY l.sortOrder ASC
    `).all() as any[];

    const listsByContact = new Map<string, any[]>();
    for (const lr of listRows) {
      if (!listsByContact.has(lr.contactId)) listsByContact.set(lr.contactId, []);
      listsByContact.get(lr.contactId)!.push({ id: lr.id, name: lr.name, icon: lr.icon, sortOrder: lr.sortOrder });
    }

    return rows.map(({ _tags, _allEmails, _allPhones, ...r }) => ({
      ...r,
      isGhost: !!r.isGhost,
      isArchived: !!r.isArchived,
      tags: _tags ? _tags.split(',').map((tag: string) => ({ id: tag, tag })) : [],
      lists: listsByContact.get(r.id) || [],
      interactionCount: r.interactionCount ?? 0,
      emails: _allEmails ? _allEmails.split(',').map((e: string) => ({ email: e })) : [],
      phones: _allPhones ? _allPhones.split(',').map((p: string) => ({ phone: p })) : [],
      socialLinks: [], education: [], experience: [],
      sources: [], addresses: [], interests: [], attributes: [],
    }));
  },

  getAllContacts() {
    const all = sqlite.prepare("SELECT * FROM contacts WHERE (isArchived = 0 OR isArchived IS NULL) ORDER BY addedAt DESC").all();
    return contactRepo.hydrateMany(all);
  },

  getContactById(id: string) {
    const contact = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
    if (!contact) return null;
    return contactRepo.hydrate(contact);
  }
};
