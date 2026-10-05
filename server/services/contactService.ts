import { assertOwnedContact } from "./contactGuard.ts";
import crypto from "crypto";
import fs from "fs";
import { ownerUploadUrl, resolveOwnUploadPath } from "../utils/paths.ts";
import { db, sqlite } from "../db.ts";
import * as schema from "../db/schema.ts";
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
import { pinState, queueGeocode, type PinState } from "./geocoding/index.ts";
import {
  processBase64Avatar,
  isBase64DataUri,
} from "../utils/avatarProcessor.ts";
import { aiCache } from "../utils/aiCache.ts";
import { scopeForOwnerId, type Scope } from "../tenancy/scope.ts";
import { buildContactUpdate } from "../utils/helpers.ts";
import { defaultAvatarUrl, isDefaultAvatarFor } from "./avatarService.ts";
import { removeFromIndexQueue } from "./search/indexQueue.ts";
import { doubleMetaphone } from "../utils/nlp/index.ts";
import { log } from "../utils/logger.ts";
import { importService } from "./importService.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { getPreferences } from "./userPreferencesService.ts";
import { trashRetentionDays } from "./lifecycleSettings.ts";
import {
  expiredMergedContacts,
  forgetExpiredMerges,
  forgetPurgedContacts,
  MERGE_UNDO_DAYS,
  mergedChain,
  uploadsOfContacts,
} from "./contactPurge.ts";
import { removeUploads } from "./uploadCleanup.ts";
import { AppError } from "../utils/AppError.ts";
import { dispatchEvents, recordEvent } from "../events/index.ts";
// The reactions to a contact write: the search index, the dedupe vector and
// the duplicate check, the geocoder, the score, the owner's caches and
// auto-enrichment. They register when this module loads, so every process
// that writes a contact through this service runs them.
import "../events/contactSubscribers.ts";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
// Every write below records an event inside its transaction and calls
// dispatchEvents() after the transaction returns, before it reads its answer.
// The follow-up work is the subscribers' (server/events/
// contactSubscribers.ts), and they decide from the event, so every path that
// sets a field gets the same reactions.
// ---------------------------------------------------------------------------

/**
 * The request names of the fields an update writes: the columns it sets,
 * without the two this service derives (`updatedAt`, `phoneticHash`), and
 * the relations the body replaces.
 */
function changedFields(
  update: Record<string, unknown>,
  body: Record<string, unknown> = {},
): string[] {
  const columns = Object.keys(update).filter(
    (key) => key !== "updatedAt" && key !== "phoneticHash",
  );
  const relations = Object.keys(RELATION_REGISTRY).filter((key) =>
    Array.isArray(body[key]),
  );
  return [...columns, ...relations];
}

/**
 * Dispatch the events of a write that touched many contacts with the AI
 * cache in batch mode, so the invalidations collapse into one per tier.
 */
function dispatchAsBatch(): void {
  aiCache.enterBatchMode();
  try {
    dispatchEvents();
  } finally {
    aiCache.exitBatchMode();
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Map a contact body to the contacts-table insert values.
 * Centralised here so createContact + bulkCreateContacts stay DRY.
 * Any field not listed here will never reach the database.
 */
function buildInsertValues(
  scope: Scope,
  body: NewContactPayload,
  id: string,
  options: { manual: boolean },
) {
  // Every contact starts untracked unless the body says otherwise, or a
  // person adds it by hand under the `trackNewContacts` preference. Imports
  // and connectors never track: a file of two thousand people is not a
  // choice about any one of them.
  const isTracked =
    body.isTracked ??
    (options.manual && getPreferences(scope.ownerId).trackNewContacts);
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
    cadenceDays:
      body.cadenceDays ??
      getPreferences(scope.ownerId).defaultCadenceDays ??
      90,
    about: body.about || null,
    pronouns: body.pronouns || null,
    industry: body.industry || null,
    website: body.website || null,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    themeColor: body.themeColor ?? "brand",
    isGhost: body.isGhost ? 1 : 0,
    isArchived: body.isArchived ? 1 : 0,
    isTracked: isTracked ? 1 : 0,
    nextFollowUpAt: body.nextFollowUpAt ?? null,
    aiSummary: body.aiSummary ?? null,
    aiBackground: body.aiBackground ?? null,
    aiBriefing: body.aiBriefing ?? null,
    aiBriefingAt: body.aiBriefingAt ?? null,
    phoneticHash: body.name ? doubleMetaphone(body.name).primary : null,
  };
}

/**
 * Keep the default face in step with the name and pronouns it was drawn from.
 *
 * When an edit changes either, and the contact still wears the default avatar
 * for its old name, the update carries the new default. A face from the
 * picker, a photo, and an edit that sets `avatarUrl` itself are left alone.
 */
function redrawDefaultAvatar(
  scope: Scope,
  id: string,
  body: Record<string, unknown>,
  update: Record<string, unknown>,
): void {
  if (body.avatarUrl !== undefined) return;
  const renamed = typeof body.name === "string" && body.name.trim() !== "";
  const pronounsChanged = body.pronouns !== undefined;
  if (!renamed && !pronounsChanged) return;

  const existing = contactRepo.findOwned(scope, id);
  const oldName = typeof existing?.name === "string" ? existing.name : null;
  const oldUrl =
    typeof existing?.avatarUrl === "string" ? existing.avatarUrl : null;
  if (!oldName || !isDefaultAvatarFor(oldUrl, oldName)) return;

  const name = renamed ? (body.name as string) : oldName;
  const pronouns = pronounsChanged
    ? typeof body.pronouns === "string"
      ? body.pronouns
      : null
    : typeof existing?.pronouns === "string"
      ? existing.pronouns
      : null;
  const next = defaultAvatarUrl(name, pronouns);
  if (next !== oldUrl) update.avatarUrl = next;
}

/**
 * What turning tracking on means, beyond the flag.
 *
 * Cadence is the second half of Track: it is set at the moment a contact is
 * tracked, from the body when it names one, else from the owner's default.
 * Only rows that are untracked now take the default, so tracking somebody
 * twice, or with a cadence of their own, changes nothing. Runs inside the
 * caller's transaction, before the flag itself is written.
 *
 * `trackedAt` needs no code here: the `contacts_track_stamp_*` triggers in
 * server/db.ts write it.
 */
function applyTrackingRules(
  scope: Scope,
  ids: string[],
  body: Record<string, unknown>,
): void {
  if (body.isTracked !== true || ids.length === 0) return;
  if (typeof body.cadenceDays === "number") return;
  const cadence = getPreferences(scope.ownerId).defaultCadenceDays ?? 90;
  sqlite
    .prepare(
      `UPDATE contacts SET cadenceDays = ?
        WHERE ownerId = ? AND isTracked = 0
          AND id IN (${ids.map(() => "?").join(", ")})`,
    )
    .run(cadence, scope.ownerId, ...ids);
}

/**
 * Remove a contact's search artifacts (vec0 embeddings + dedupe metadata).
 * FTS rows are handled by the trash-aware triggers. vec0 tables don't support
 * FK cascading, so this must run on every soft delete and hard delete.
 */
function purgeContactSearchArtifacts(id: string): void {
  removeFromIndexQueue(id);
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

// ---------------------------------------------------------------------------
// Geocoding triggers
// ---------------------------------------------------------------------------

/**
 * Hand a pin back to the geocoder when the write moved its address.
 *
 * A pin placed by hand is not the geocoder's to move. The write may change
 * anything else about the contact and the pin stays where the person put it.
 * Only a change to the address the contact shows hands the pin back: the
 * address moved from under it, so `geoSource` is cleared, and the
 * `contacts.geocode` subscriber queues the new text after the commit. Until
 * the geocoder answers, the old coordinates stand.
 *
 * Runs inside the write's transaction, after the change. The release is part
 * of the write: the subscriber runs after the commit, when the address before
 * the write can no longer be read.
 *
 * @returns true when the pin was handed back.
 */
function releaseMovedPin(scope: Scope, id: string, before: PinState): boolean {
  if (!before.manual) return false;
  const after = pinState(scope.ownerId, id);
  if (after.shown === before.shown) return false;
  sqlite
    .prepare(
      `UPDATE contacts SET geoSource = NULL WHERE id = ? AND ownerId = ?`,
    )
    .run(id, scope.ownerId);
  return true;
}

/**
 * Permanently delete a contact, every contact merged into it, and the merge
 * log entries that name them (contactPurge.ts). Children cascade, and the
 * vectors go here. Runs inside the caller's transaction.
 *
 * @returns the upload URLs the deleted rows named, for `removeUploads` after
 *   the commit, or null when the contact is not the caller's.
 */
function hardDeleteContact(scope: Scope, id: string): string[] | null {
  const ids = mergedChain(scope, id);
  if (ids.length === 0) return null;
  const uploads = uploadsOfContacts(scope, ids);
  for (const each of ids) purgeContactSearchArtifacts(each);
  forgetPurgedContacts(scope, ids);
  sqlite
    .prepare(
      `DELETE FROM contacts
        WHERE ownerId = ? AND id IN (${ids.map(() => "?").join(", ")})`,
    )
    .run(scope.ownerId, ...ids);
  return uploads;
}

/** Unlink each owner's collected uploads, after the purge committed. */
function removePurgedUploads(byOwner: Map<string, string[]>): void {
  for (const [ownerId, urls] of byOwner) removeUploads(ownerId, urls);
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
  | "geoSource"
  | "relationshipScore"
  | "isTracked"
  | "trackedAt"
  | "aiHydratedAt"
  | "birthday"
> & {
  /** The last research run's outcome, read from `aiResearch` in SQL. */
  researchOutcome: string | null;
};

/** The outcomes a research run records (shared/researchRecord.ts). */
const RESEARCH_OUTCOMES = new Set(["added", "nothing-new", "no-public-info"]);

export const contactService = {
  /**
   * Add one contact.
   *
   * @param source - The provenance stamp for the child rows: "manual", or a
   *   connector's kind.
   * @param options.autoEnrich - True only when a person added this contact,
   *   in the app or through the REST API. Then "Enrich new contacts
   *   automatically" may research it. A Google sync and an MCP client add
   *   contacts that nobody chose one by one, so they leave it unset.
   */
  createContact(
    scope: Scope,
    body: NewContactPayload,
    source: string = "manual",
    options: { autoEnrich?: boolean } = {},
  ) {
    const id = crypto.randomUUID();
    const values = buildInsertValues(scope, body, id, {
      manual: source === "manual",
    });

    // No picture given: the default face, drawn from the pronouns when the
    // contact has them and from the name otherwise.
    if (!values.avatarUrl && body.name) {
      values.avatarUrl = defaultAvatarUrl(body.name, body.pronouns);
    }

    const txn = sqlite.transaction(() => {
      // The owner is spelled out at the write, not only inside the value
      // builder. It is the one column a reviewer and the tenant lint both have
      // to be able to see without following a helper.
      db.insert(schema.contacts)
        .values({ ...values, ownerId: scope.ownerId })
        .run();
      contactRepo.insertChildRecords(id, body, source);
      recordEvent(scope, "contact.created", id, {
        origin: source === "manual" ? "manual" : "connector",
        autoEnrich: options.autoEnrich === true,
      });
    });
    txn();
    // The geocoder, the dedupe vector, the search index, the duplicate check,
    // auto-enrichment and the caches.
    dispatchEvents();

    return contactRepo.hydrate(contactRepo.findOwned(scope, id));
  },

  /**
   * Write a batch of contacts in one transaction.
   *
   * With an `importId`, every row is written under a savepoint of its own and
   * a row that throws is recorded as failed, with its payload, while the rest
   * of the batch commits. The import's status moves to `imported` inside the
   * same transaction, so the record can never say the contacts are there
   * when they are not. `rowIndexes` gives each row its line in the import,
   * which a retry uses to land a row back where it was.
   *
   * Without an `importId` the batch is all or nothing, as it always was. The
   * eval harness and the tests seed corpora through this path, and a partial
   * corpus would be worse than a thrown one.
   */
  async bulkCreateContacts(
    scope: Scope,
    validContacts: NewContactPayload[],
    onProgress?: (processed: number, total: number, phase: string) => void,
    options: { importId?: string; rowIndexes?: number[] } = {},
  ): Promise<{ count: number; createdIds: string[]; failed: number }> {
    const total = validContacts.length;
    const { importId, rowIndexes } = options;

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
    let failed = 0;
    const createdIds: string[] = [];
    try {
      /** One row. A savepoint when nested in the batch below. */
      const insertOne = sqlite.transaction((c: NewContactPayload) => {
        const id = crypto.randomUUID();
        // An import, so never tracked by the preference.
        const values = buildInsertValues(scope, c, id, { manual: false });

        // No picture given: the default face, as for a single create.
        if (!values.avatarUrl && c.name) {
          values.avatarUrl = defaultAvatarUrl(c.name, c.pronouns);
        }

        db.insert(schema.contacts)
          .values({ ...values, ownerId: scope.ownerId })
          .run();
        contactRepo.insertChildRecords(id, c, c._sourcePlatform || "manual");
        // Under the row's savepoint, so a row that fails takes its event
        // with it.
        recordEvent(scope, "contact.created", id, {
          origin: "import",
          autoEnrich: false,
        });
        return id;
      });

      const txn = sqlite.transaction(() => {
        for (let i = 0; i < validContacts.length; i++) {
          const c = validContacts[i];
          const index = rowIndexes?.[i] ?? i;
          let id: string;
          try {
            id = insertOne(c);
          } catch (err: unknown) {
            // No import record, no place to put a failed row: the batch is
            // all or nothing, and this rethrow rolls it back.
            if (!importId) throw err;
            failed++;
            const message = getErrorMessage(err);
            importService.rowFailed(scope, importId, index, c.name, message, c);
            log.warn(
              "ContactService",
              `Import ${importId} row ${index} ("${c.name}") failed: ${message}`,
            );
            continue;
          }
          createdIds.push(id);
          count++;
          if (importId)
            importService.rowDone(scope, importId, index, id, c.name);
        }
        // Inside the transaction on purpose. The status and the contacts
        // commit together or not at all.
        if (importId) importService.markImported(scope, importId);
      });
      txn();
      // Inside the cache's batch mode, so the rows' invalidations are one.
      dispatchEvents();
      onProgress?.(total, total, "Complete");
    } finally {
      aiCache.exitBatchMode();
    }
    return { count, createdIds, failed };
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
          const moved = trashStmt.run(now, id, scope.ownerId).changes;
          count += moved;
          purgeContactSearchArtifacts(id);
          if (moved > 0) {
            recordEvent(scope, "contact.deleted", id, { permanent: false });
          }
        }
      });
      deleteFn();
      dispatchEvents();
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
      const changed = changedFields(update);
      if (typeof data.name === "string")
        update.phoneticHash = doubleMetaphone(data.name).primary;
      // Safety: buildContactUpdate returns only keys from a hardcoded whitelist
      // (see utils/helpers.ts). Interpolating those key names into SQL is safe
      // because no user-supplied string reaches the SET clause — only column names.
      const updateFn = sqlite.transaction(() => {
        applyTrackingRules(scope, owned, data);
        const setClauses = Object.keys(update)
          .map((k) => `${k} = ?`)
          .join(", ");
        const values = Object.values(update);
        const stmt = sqlite.prepare(
          `UPDATE contacts SET ${setClauses}
            WHERE id = ? AND ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL`,
        );
        for (const id of owned) {
          if (stmt.run(...values, id, scope.ownerId).changes) {
            changedIds.push(id);
            if (changed.length > 0) {
              recordEvent(scope, "contact.updated", id, {
                changed,
                bulk: true,
              });
            }
          }
        }
      });
      updateFn();
      dispatchEvents();
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
    redrawDefaultAvatar(scope, id, body, updateData);
    const changed = changedFields(updateData, body as Record<string, unknown>);

    const txn = sqlite.transaction(() => {
      const pinBefore = pinState(scope.ownerId, id);
      applyTrackingRules(scope, [id], body as Record<string, unknown>);
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

      const released = releaseMovedPin(scope, id, pinBefore);
      if (changed.length > 0) {
        recordEvent(scope, "contact.updated", id, {
          changed: released ? [...changed, "geoSource"] : changed,
          bulk: false,
        });
      }
    });
    txn();
    // Before the read below: the score of a contact that was just tracked is
    // on the answer, not an hour later.
    dispatchEvents();

    const updated = contactRepo.hydrate(contactRepo.findOwned(scope, id));
    if (!updated) return null;
    return updated;
  },

  patchContact(scope: Scope, id: string, body: Record<string, unknown>) {
    assertOwnedContact(scope, id);
    const update = buildContactUpdate(body);
    // The same as updateContact: dedupe's phonetic blocking reads this hash,
    // and a rename by PATCH used to leave the old one behind.
    if (typeof body.name === "string" && body.name) {
      update.phoneticHash = doubleMetaphone(body.name).primary;
    }
    redrawDefaultAvatar(scope, id, body, update);
    // A PATCH carries no child arrays, so `location` is the one address
    // field it can move. It records the same event as a PUT that sets the
    // same fields, and so gets the same reactions.
    const changed = changedFields(update);
    const write = sqlite.transaction(() => {
      const pinBefore = pinState(scope.ownerId, id);
      applyTrackingRules(scope, [id], body);
      db.update(schema.contacts)
        .set(update)
        .where(
          and(
            eq(schema.contacts.id, id),
            eq(schema.contacts.ownerId, scope.ownerId),
          ),
        )
        .run();
      const released = releaseMovedPin(scope, id, pinBefore);
      if (changed.length > 0) {
        recordEvent(scope, "contact.updated", id, {
          changed: released ? [...changed, "geoSource"] : changed,
          bulk: false,
        });
      }
    });
    write();
    dispatchEvents();

    const updated = contactRepo.hydrate(contactRepo.findOwned(scope, id));
    if (!updated) return null;
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
    sqlite.transaction(() => {
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
      recordEvent(scope, "contact.deleted", id, { permanent: false });
    })();
    dispatchEvents();
    return true;
  },

  /** Restore a trashed contact to the active list. */
  restoreContact(scope: Scope, id: string) {
    const existing = contactRepo.findOwned(scope, id);
    if (!existing || !existing.deletedAt) return null;

    // Clearing deletedAt makes the contacts_au trigger reinsert the FTS row.
    // The event's subscribers rebuild the vectors the delete purged.
    sqlite.transaction(() => {
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
      recordEvent(scope, "contact.restored", id, {});
    })();
    dispatchEvents();

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

  /**
   * Permanently delete one trashed contact ("delete forever"), with the
   * contacts merged into it, and then its files.
   */
  purgeTrashedContact(scope: Scope, id: string) {
    const existing = contactRepo.findOwned(scope, id);
    if (!existing?.deletedAt) return false; // only trashed rows can be purged
    const uploads = sqlite.transaction(() => {
      const deleted = hardDeleteContact(scope, id);
      if (deleted) {
        recordEvent(scope, "contact.deleted", id, { permanent: true });
      }
      return deleted;
    })();
    dispatchEvents();
    if (!uploads) return false;
    removeUploads(scope.ownerId, uploads);
    return true;
  },

  /**
   * Delete the merged-away contacts whose merge can no longer be undone,
   * with their files, and the merge log entries older than the undo window
   * (MERGE_UNDO_DAYS). The surviving contact keeps what the merge gave it.
   * Run daily by the job `contacts.mergePurge`.
   *
   * @returns the number of merged-away contacts deleted.
   */
  purgeExpiredMerges(days = MERGE_UNDO_DAYS) {
    const expired = expiredMergedContacts(days);
    const uploads = new Map<string, string[]>();
    let entries = 0;
    sqlite.transaction(() => {
      for (const row of expired) {
        const removed = hardDeleteContact(scopeForOwnerId(row.ownerId), row.id);
        if (removed) {
          uploads.set(row.ownerId, [
            ...(uploads.get(row.ownerId) ?? []),
            ...removed,
          ]);
        }
      }
      entries = forgetExpiredMerges(days);
    })();
    removePurgedUploads(uploads);
    if (expired.length > 0 || entries > 0) {
      log.info(
        "ContactService",
        `Merge undo window passed: deleted ${expired.length} merged-away contact(s) and ${entries} merge log entries`,
      );
    }
    return expired.length;
  },

  /**
   * Hard-delete trash older than the retention window. Called on startup and
   * daily. Returns the number of contacts purged.
   */
  purgeExpiredTrash(retentionDays?: number) {
    const days = retentionDays ?? trashRetentionDays().value;
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
    const uploads = new Map<string, string[]>();
    const txn = sqlite.transaction(() => {
      for (const row of expired) {
        const scope = scopeForOwnerId(row.ownerId);
        const removed = hardDeleteContact(scope, row.id);
        if (removed) {
          recordEvent(scope, "contact.deleted", row.id, { permanent: true });
          uploads.set(row.ownerId, [
            ...(uploads.get(row.ownerId) ?? []),
            ...removed,
          ]);
        }
      }
    });
    txn();
    // The sweep spans accounts, and each event names its own owner, so each
    // owner it touched loses its own cache entries, once.
    dispatchAsBatch();
    removePurgedUploads(uploads);
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
    // The old photo goes only when it is in this owner's own avatars folder.
    // avatarUrl is user-writable through the update endpoints, so it may name
    // another account's file, a shared logo, or a `..` path to either.
    const oldPath = previousUrl
      ? resolveOwnUploadPath(scope.ownerId, previousUrl, "avatars")
      : null;
    if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

    sqlite.transaction(() => {
      db.update(schema.contacts)
        .set({ avatarUrl, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(schema.contacts.id, id),
            eq(schema.contacts.ownerId, scope.ownerId),
          ),
        )
        .run();
      recordEvent(scope, "contact.updated", id, {
        changed: ["avatarUrl"],
        bulk: false,
      });
    })();
    dispatchEvents();

    const updated = contactRepo.hydrate(contactRepo.findOwned(scope, id));
    if (!updated) return null;
    return updated;
  },

  /**
   * Put the pin where a person dropped it.
   *
   * `geoSource = 'manual'` is what keeps the geocoder off it from now on: the
   * startup sweep leaves the row alone, and a later edit to the contact
   * queues nothing unless it changes the address the pin was read from.
   * The edit trigger skips pin columns, so a person's move stamps updatedAt here.
   */
  setLocation(scope: Scope, id: string, lat: number, lng: number) {
    assertOwnedContact(scope, id);
    sqlite.transaction(() => {
      db.update(schema.contacts)
        .set({
          lat,
          lng,
          geoSource: "manual",
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.contacts.id, id),
            eq(schema.contacts.ownerId, scope.ownerId),
          ),
        )
        .run();
      recordEvent(scope, "contact.updated", id, {
        changed: ["lat", "lng", "geoSource"],
        bulk: false,
      });
    })();
    dispatchEvents();
    return contactRepo.hydrate(contactRepo.findOwned(scope, id));
  },

  /**
   * Hand the pin back to the geocoder.
   *
   * The coordinates go first, so the contact leaves the map until the
   * geocoder answers rather than sitting on a pin that is nobody's decision
   * any more. The geocoder then reads the same text it read the first time.
   * A cached answer lands before this returns. A new one lands when the
   * queue drains.
   *
   * The geocoder call here is the request itself, not a reaction to it, so
   * it stays in this function. The event's subscribers drop the caches.
   * A contact with no address text keeps its pin, and the request is refused.
   */
  regeocode(scope: Scope, id: string) {
    assertOwnedContact(scope, id);
    const text = pinState(scope.ownerId, id).shown;
    if (!text) {
      throw new AppError(
        "This contact has no address to place the pin from. Add an address, or place the pin by hand",
        400,
        { code: "NO_ADDRESS" },
      );
    }
    sqlite.transaction(() => {
      db.update(schema.contacts)
        .set({ lat: null, lng: null, geoSource: null })
        .where(
          and(
            eq(schema.contacts.id, id),
            eq(schema.contacts.ownerId, scope.ownerId),
          ),
        )
        .run();
      recordEvent(scope, "contact.updated", id, {
        changed: ["lat", "lng", "geoSource"],
        bulk: false,
      });
    })();
    dispatchEvents();
    queueGeocode(id, text);
    return contactRepo.hydrate(contactRepo.findOwned(scope, id));
  },

  getMapContacts(scope: Scope) {
    return sqlite
      .prepare(
        `SELECT id, name, company, avatarUrl, location, lat, lng, geoSource
          FROM contacts
          WHERE ownerId = ? AND lat IS NOT NULL AND lng IS NOT NULL
            AND (isArchived = 0 OR isArchived IS NULL)
            AND deletedAt IS NULL AND canonicalId IS NULL
            AND (isGhost = 0 OR isGhost IS NULL)`,
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
             lat, lng, geoSource, relationshipScore, isTracked, trackedAt, aiHydratedAt, birthday,
             -- The last run's outcome, for the Enrichment page's "Found
             -- nothing" filter, without sending every record's JSON.
             CASE WHEN json_valid(aiResearch)
               THEN json_extract(aiResearch, '$.runs[#-1].outcome') END AS researchOutcome
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
      isTracked: !!r.isTracked,
      researchOutcome:
        r.researchOutcome && RESEARCH_OUTCOMES.has(r.researchOutcome)
          ? r.researchOutcome
          : null,
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
