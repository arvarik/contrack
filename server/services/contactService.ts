import { assertOwnedContact } from "./contactGuard.ts";
import crypto from "crypto";
import fs from "fs";
import { ownerUploadUrl, resolveUploadPath } from "../utils/paths.ts";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { and, eq } from "drizzle-orm";
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
import { scopeForOwnerId, type Scope } from "../tenancy/scope.ts";
import { buildContactUpdate } from "../utils/helpers.ts";
import { buildAvatarUrl } from "./avatarService.ts";
import { generateAndStoreEmbedding } from "./dedupe/embeddings.ts";
import { scheduleSearchIndex } from "./search/indexQueue.ts";
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
 * Fields that trigger local search re-indexing
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
function buildInsertValues(scope: Scope, body: NewContactPayload, id: string) {
  return {
    id,
    // The owner comes from the caller's scope, not from the request context.
    // A context can be lost across a library boundary; a parameter cannot.
    // The contacts_owner_required trigger refuses the insert either way, so a
    // lost owner is a failed write rather than a row nobody can see.
    ownerId: scope.ownerId,
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
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    themeColor: body.themeColor ?? "brand",
    isGhost: body.isGhost ? 1 : 0,
    isArchived: body.isArchived ? 1 : 0,
    nextFollowUpAt: body.nextFollowUpAt ?? null,
    aiSummary: body.aiSummary ?? null,
    aiBackground: body.aiBackground ?? null,
    aiBriefing: body.aiBriefing ?? null,
    aiBriefingAt: body.aiBriefingAt ?? null,
    phoneticHash: body.name ? doubleMetaphone(body.name).primary : null,
  };
}

/**
 * Invalidate the caches that depend on one owner's contact data.
 *
 * Deliberately NOT invalidateAll(): the content-addressed tiers (queryParse,
 * hyde, mentions) hash their own input text and are unaffected by contact
 * mutations — flushing them on every edit made repeat searches pay full AI
 * cost for nothing.
 *
 * Since 2f each of the four tiers below is owner-keyed, so one account's edit
 * drops one account's entries. It used to flush every tier whole, which made
 * one person adding a contact cost everybody else on the instance a fresh
 * search, briefing and insight through a paid provider.
 */
function invalidateOwnerCaches(scope: Scope) {
  for (const tier of ["rerank", "synthesis", "dailyInsight", "briefing"])
    aiCache.invalidateForOwner(tier, scope.ownerId);
}

/**
 * Remove a contact's search artifacts (vec0 embeddings + dedupe metadata).
 * FTS rows are handled by the trash-aware triggers. vec0 tables don't support
 * FK cascading, so this must run on every soft delete and hard delete.
 */
function purgeContactSearchArtifacts(id: string): void {
  try {
    sqlite
      // tenant-lint: allow owner-checked by caller
      .prepare("DELETE FROM search_embeddings WHERE contactId = ?")
      .run(id);
  } catch {
    /* vec0 row may not exist */
  }
  try {
    sqlite
      // tenant-lint: allow owner-checked by caller
      .prepare("DELETE FROM contact_embeddings WHERE contactId = ?")
      .run(id);
  } catch {
    /* vec0 row may not exist */
  }
  sqlite
    .prepare("DELETE FROM dedupe_embedding_meta WHERE contactId = ?")
    .run(id);
}

/** Permanently delete a contact row (children cascade; embeddings purged). */
function hardDeleteContact(scope: Scope, id: string): boolean {
  purgeContactSearchArtifacts(id);
  const result = db
    .delete(schema.contacts)
    .where(
      and(
        eq(schema.contacts.id, id),
        eq(schema.contacts.ownerId, scope.ownerId),
      ),
    )
    .returning()
    .get();
  return !!result;
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
  createContact(
    scope: Scope,
    body: NewContactPayload,
    source: string = "manual",
  ) {
    const id = crypto.randomUUID();
    const values = buildInsertValues(scope, body, id);

    // Smart avatar: if no avatar was provided, generate a gender-aware one
    if (!values.avatarUrl && body.name) {
      values.avatarUrl = buildAvatarUrl(body.name);
    }

    const txn = sqlite.transaction(() => {
      // The owner is spelled out at the write, not only inside the value
      // builder. It is the one column a reviewer and the tenant lint both have
      // to be able to see without following a helper.
      db.insert(schema.contacts)
        .values({ ...values, ownerId: scope.ownerId })
        .run();
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

    scheduleSearchIndex(id);

    // Fire-and-forget: incremental dedupe check (debounced)
    scheduleIncrementalDedupe(id);

    invalidateOwnerCaches(scope);
    return contactRepo.hydrate(contactRepo.findOwned(scope, id));
  },

  async bulkCreateContacts(
    scope: Scope,
    validContacts: NewContactPayload[],
    onProgress?: (processed: number, total: number, phase: string) => void,
  ): Promise<{ count: number; createdIds: string[] }> {
    const total = validContacts.length;

    // Phase 1: Process base64 data-URI avatars (from VCF imports) into optimized files
    // This runs before the SQLite transaction since sharp is async
    for (let i = 0; i < validContacts.length; i++) {
      const c = validContacts[i];
      if (isBase64DataUri(c.avatarUrl)) {
        const fileUrl = await processBase64Avatar(scope, c.avatarUrl);
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
          const values = buildInsertValues(scope, c, id);

          // Smart avatar: gender-aware DiceBear URL if no avatar was provided
          if (!values.avatarUrl && c.name) {
            values.avatarUrl = buildAvatarUrl(c.name);
          }

          db.insert(schema.contacts)
            .values({ ...values, ownerId: scope.ownerId })
            .run();
          contactRepo.insertChildRecords(id, c, c._sourcePlatform || "manual");
          if (c.location) queueGeocode(id, c.location);
          createdIds.push(id);
          count++;
        }
      });
      txn();
      onProgress?.(total, total, "Complete");

      invalidateOwnerCaches(scope);
    } finally {
      aiCache.exitBatchMode();
    }
    return { count, createdIds };
  },

  /**
   * Soft-delete a batch of contacts (same trash semantics as deleteContact).
   *
   * Foreign ids are dropped by `findManyOwned` before anything runs, so the
   * count the caller gets back is the number of their own rows that moved. A
   * request that mixes another owner's ids in reports only its own.
   */
  bulkDeleteContacts(scope: Scope, ids: string[]) {
    let count = 0;
    aiCache.enterBatchMode();
    try {
      const now = new Date().toISOString();
      const owned = contactRepo.findManyOwned(scope, ids).map((r) => r.id);
      const trashStmt = sqlite.prepare(
        `UPDATE contacts SET deletedAt = ?, isArchived = 1
          WHERE id = ? AND ownerId = ? AND deletedAt IS NULL`,
      );
      const deleteFn = sqlite.transaction(() => {
        for (const id of owned) {
          count += trashStmt.run(now, id, scope.ownerId).changes;
          purgeContactSearchArtifacts(id);
        }
      });
      deleteFn();
      invalidateOwnerCaches(scope);
    } finally {
      aiCache.exitBatchMode();
    }
    return count;
  },

  bulkUpdateContacts(
    scope: Scope,
    ids: string[],
    data: Record<string, unknown>,
  ) {
    const changedIds: string[] = [];
    aiCache.enterBatchMode();
    try {
      const owned = contactRepo.findManyOwned(scope, ids).map((r) => r.id);
      const update = buildContactUpdate(data);
      if (typeof data.name === "string")
        update.phoneticHash = doubleMetaphone(data.name).primary;
      // Safety: buildContactUpdate returns only keys from a hardcoded whitelist
      // (see utils/helpers.ts). Interpolating those key names into SQL is safe
      // because no user-supplied string reaches the SET clause — only column names.
      const updateFn = sqlite.transaction(() => {
        const setClauses = Object.keys(update)
          .map((k) => `${k} = ?`)
          .join(", ");
        const values = Object.values(update);
        const stmt = sqlite.prepare(
          `UPDATE contacts SET ${setClauses}
            WHERE id = ? AND ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL`,
        );
        for (const id of owned) {
          if (stmt.run(...values, id, scope.ownerId).changes)
            changedIds.push(id);
        }
      });
      updateFn();
      for (const id of changedIds) scheduleSearchIndex(id);
      invalidateOwnerCaches(scope);
    } finally {
      aiCache.exitBatchMode();
    }
    return changedIds.length;
  },

  updateContact(scope: Scope, id: string, body: ContactPayload) {
    assertOwnedContact(scope, id);
    // Recompute phoneticHash if name changed
    const updateData = buildContactUpdate(body);
    if (body.name) {
      updateData.phoneticHash = doubleMetaphone(body.name).primary;
    }

    const txn = sqlite.transaction(() => {
      db.update(schema.contacts)
        .set(updateData)
        .where(
          and(
            eq(schema.contacts.id, id),
            eq(schema.contacts.ownerId, scope.ownerId),
          ),
        )
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

    const updated = contactRepo.hydrate(contactRepo.findOwned(scope, id));
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

    if (
      SEARCH_TRIGGER_FIELDS.some((f) => body[f] !== undefined) ||
      body.tags !== undefined ||
      body.interests !== undefined
    ) {
      scheduleSearchIndex(id);
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

    invalidateOwnerCaches(scope);
    return updated;
  },

  patchContact(scope: Scope, id: string, body: Record<string, unknown>) {
    assertOwnedContact(scope, id);
    const update = buildContactUpdate(body);
    db.update(schema.contacts)
      .set(update)
      .where(
        and(
          eq(schema.contacts.id, id),
          eq(schema.contacts.ownerId, scope.ownerId),
        ),
      )
      .run();

    if (typeof body.location === "string" && body.location) {
      queueGeocode(id, body.location);
    }

    // Fire-and-forget: recompute search embedding if searchable fields changed
    // NOTE: FTS5 is already updated by the contacts_au trigger, but the
    // vector embedding + Doc2Query expansion must be refreshed explicitly.
    if (SEARCH_TRIGGER_FIELDS.some((f) => body[f] !== undefined)) {
      scheduleSearchIndex(id);
    }

    const updated = contactRepo.hydrate(contactRepo.findOwned(scope, id));
    if (!updated) return null;

    invalidateOwnerCaches(scope);
    return updated;
  },

  /**
   * Soft-delete: move the contact to trash. The row keeps its children and
   * can be restored until purgeExpiredTrash() hard-deletes it. isArchived is
   * set so every "active" surface excludes it; the trash-aware FTS triggers
   * drop it from search; embeddings are purged (regenerated on restore).
   */
  deleteContact(scope: Scope, id: string) {
    const existing = contactRepo.findOwned(scope, id);
    if (!existing) return false;
    if (existing.deletedAt) return true; // already in trash — idempotent

    const now = new Date().toISOString();
    db.update(schema.contacts)
      .set({ deletedAt: now, isArchived: 1, updatedAt: now })
      .where(
        and(
          eq(schema.contacts.id, id),
          eq(schema.contacts.ownerId, scope.ownerId),
        ),
      )
      .run();
    purgeContactSearchArtifacts(id);
    invalidateOwnerCaches(scope);
    return true;
  },

  /** Restore a trashed contact to the active list. */
  restoreContact(scope: Scope, id: string) {
    const existing = contactRepo.findOwned(scope, id);
    if (!existing || !existing.deletedAt) return null;

    // Clearing deletedAt makes the contacts_au trigger reinsert the FTS row.
    db.update(schema.contacts)
      .set({
        deletedAt: null,
        isArchived: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.contacts.id, id),
          eq(schema.contacts.ownerId, scope.ownerId),
        ),
      )
      .run();

    // Fire-and-forget: regenerate the purged embeddings.
    scheduleSearchIndex(id);
    generateAndStoreEmbedding(id).catch(() => {});

    invalidateOwnerCaches(scope);
    return contactRepo.hydrate(contactRepo.findOwned(scope, id));
  },

  /** List trashed contacts, newest deletions first. */
  listTrash(scope: Scope) {
    return sqlite
      .prepare(
        `SELECT id, name, company, avatarUrl, deletedAt FROM contacts
         WHERE ownerId = ? AND deletedAt IS NOT NULL ORDER BY deletedAt DESC`,
      )
      .all(scope.ownerId) as {
      id: string;
      name: string;
      company: string | null;
      avatarUrl: string | null;
      deletedAt: string;
    }[];
  },

  /** Permanently delete one trashed contact ("delete forever"). */
  purgeTrashedContact(scope: Scope, id: string) {
    const existing = contactRepo.findOwned(scope, id);
    if (!existing?.deletedAt) return false; // only trashed rows can be purged
    const ok = hardDeleteContact(scope, id);
    if (ok) invalidateOwnerCaches(scope);
    return ok;
  },

  /**
   * Hard-delete trash older than the retention window. Called on startup and
   * daily. Returns the number of contacts purged.
   */
  purgeExpiredTrash(retentionDays?: number) {
    const days =
      retentionDays ??
      (Number(process.env.TRASH_RETENTION_DAYS) > 0
        ? Number(process.env.TRASH_RETENTION_DAYS)
        : 30);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const expired = sqlite
      .prepare(
        // tenant-lint: allow instance sweep
        `SELECT id, ownerId FROM contacts
          WHERE deletedAt IS NOT NULL AND deletedAt < ?`,
      )
      .all(cutoff) as { id: string; ownerId: string }[];
    if (!expired.length) return 0;

    // The sweep is instance-wide, so each row is deleted in its own owner's
    // scope rather than in one caller's. Retention is a property of the row,
    // not of whoever happens to trigger the daily job.
    const txn = sqlite.transaction(() => {
      for (const row of expired) {
        hardDeleteContact(scopeForOwnerId(row.ownerId), row.id);
      }
    });
    txn();
    // The sweep spans accounts, so each owner it touched loses its own
    // entries. One flush in one scope would leave every other account holding
    // a search result that still names a contact this job deleted.
    for (const ownerId of new Set(expired.map((row) => row.ownerId)))
      invalidateOwnerCaches(scopeForOwnerId(ownerId));
    log.info(
      "ContactService",
      `Purged ${expired.length} trashed contact(s) older than ${days} days`,
    );
    return expired.length;
  },

  updateAvatar(scope: Scope, id: string, fileFilename: string) {
    // The same owner multer used for the destination directory, so the URL
    // and the file on disk cannot disagree.
    const avatarUrl = ownerUploadUrl(scope.ownerId, "avatars", fileFilename);

    const existing = contactRepo.requireOwned(scope, id);
    const previousUrl = existing.avatarUrl as string | null;
    // Matches both layouts: `/uploads/avatars/...` from before Phase 1 and
    // `/uploads/u/<owner>/avatars/...` after it. Never `/uploads/logos/`,
    // which is shared and must not be deleted with a contact's avatar.
    if (previousUrl?.includes("/avatars/")) {
      // avatarUrl is user-writable via the update endpoints — resolve it
      // through the containment check so `..` segments can't escape uploads/.
      const oldPath = resolveUploadPath(previousUrl);
      if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    db.update(schema.contacts)
      .set({ avatarUrl, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.contacts.id, id),
          eq(schema.contacts.ownerId, scope.ownerId),
        ),
      )
      .run();

    const updated = contactRepo.hydrate(contactRepo.findOwned(scope, id));
    if (!updated) return null;

    invalidateOwnerCaches(scope);
    return updated;
  },

  getMapContacts(scope: Scope) {
    return sqlite
      .prepare(
        `SELECT id, name, company, avatarUrl, location, lat, lng FROM contacts
          WHERE ownerId = ? AND lat IS NOT NULL AND lng IS NOT NULL
            AND (isArchived = 0 OR isArchived IS NULL)`,
      )
      .all(scope.ownerId);
  },

  getArchivedContacts(scope: Scope) {
    const all = sqlite
      .prepare(
        `SELECT * FROM contacts
          WHERE ownerId = ? AND isArchived = 1 AND deletedAt IS NULL
          ORDER BY updatedAt DESC`,
      )
      .all(scope.ownerId);
    return contactRepo.hydrateMany(all);
  },

  getSlimContacts(scope: Scope) {
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
      WHERE ownerId = ? AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL
      ORDER BY addedAt DESC
    `,
      )
      .all(scope.ownerId) as SlimContactRow[];
    const pass1Ms = Date.now() - startMs;

    // Pass 2: Batch fetch all relations (Separate queries are faster than GROUP_CONCAT/LEFT JOIN for large sets)
    const listStartMs = Date.now();
    const listRows = sqlite
      .prepare(
        `
      SELECT lm.contactId, l.id, l.name, l.icon, l.sortOrder
      FROM list_members lm
      JOIN lists l ON l.id = lm.listId
      WHERE lm.contactId IN (SELECT id FROM contacts WHERE ownerId = ? AND (isArchived = 0 OR isArchived IS NULL))
      ORDER BY l.sortOrder ASC
    `,
      )
      .all(scope.ownerId) as {
      contactId: string;
      id: string;
      name: string;
      icon: string | null;
      sortOrder: number;
    }[];

    // One subselect, six statements. The owner predicate lives inside it, so
    // every child-table read below is bounded by the caller's contacts rather
    // than by the whole instance. Each statement now takes one parameter.
    const unarchivedQuery = `WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ? AND (isArchived = 0 OR isArchived IS NULL))`;
    const tagRows = sqlite
      .prepare(`SELECT contactId, tag FROM contact_tags ${unarchivedQuery}`)
      .all(scope.ownerId) as { contactId: string; tag: string }[];
    const emailRows = sqlite
      .prepare(`SELECT contactId, email FROM contact_emails ${unarchivedQuery}`)
      .all(scope.ownerId) as { contactId: string; email: string }[];
    const phoneRows = sqlite
      .prepare(`SELECT contactId, phone FROM contact_phones ${unarchivedQuery}`)
      .all(scope.ownerId) as { contactId: string; phone: string }[];
    // `interactions` is owned, so it names the owner itself rather than
    // borrowing the subselect's. Phase 1's mismatch trigger guarantees an
    // interaction's owner equals its contact's, so the two agree by construction.
    const interactionCounts = sqlite
      .prepare(
        `SELECT contactId, COUNT(*) as cnt FROM interactions
          WHERE ownerId = ? AND contactId IN (SELECT id FROM contacts WHERE ownerId = ? AND (isArchived = 0 OR isArchived IS NULL))
          GROUP BY contactId`,
      )
      .all(scope.ownerId, scope.ownerId) as {
      contactId: string;
      cnt: number;
    }[];
    const socialLinkCounts = sqlite
      .prepare(
        `SELECT contactId, COUNT(*) as cnt FROM contact_social_links ${unarchivedQuery} GROUP BY contactId`,
      )
      .all(scope.ownerId) as { contactId: string; cnt: number }[];
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

  getAllContacts(scope: Scope) {
    const all = sqlite
      .prepare(
        `SELECT * FROM contacts
          WHERE ownerId = ? AND (isArchived = 0 OR isArchived IS NULL)
            AND canonicalId IS NULL
          ORDER BY addedAt DESC`,
      )
      .all(scope.ownerId);
    return contactRepo.hydrateMany(all);
  },

  getContactById(scope: Scope, id: string) {
    const contact = contactRepo.findOwnedActive(scope, id);
    if (!contact) return null;
    return contactRepo.hydrate(contact);
  },
};
