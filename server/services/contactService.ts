import { assertOwnedContact } from "./contactGuard.ts";
import crypto from "crypto";
import fs from "fs";
import { ownerUploadUrl, resolveOwnUploadPath } from "../utils/paths.ts";
import { db, sqlite } from "../db.ts";
import type Database from "better-sqlite3";
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

// Every write below records an event inside its transaction and calls
// dispatchEvents() after the transaction returns, before it reads its answer.
// The subscribers (server/events/contactSubscribers.ts) decide the follow-up
// work from the event, so every path that sets a field gets the same reactions.

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
 * Rows an import writes in one transaction. The event loop runs between two
 * batches, so other requests wait for one batch, about 0.1 s at 10,000
 * contacts, and not for the whole file.
 */
const IMPORT_BATCH_ROWS = 250;

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

/** The statements of `followUpTo`, prepared once, on first use. */
let followUpPrepared: {
  open: Database.Statement;
  complete: Database.Statement;
  move: Database.Statement;
  add: Database.Statement;
} | null = null;

function followUpStatements() {
  followUpPrepared ??= {
    open: sqlite.prepare(
      `SELECT id, dueAt FROM action_items
        WHERE contactId = ? AND ownerId = ? AND completedAt IS NULL
        ORDER BY dueAt IS NULL, dueAt ASC`,
    ),
    complete: sqlite.prepare(
      `UPDATE action_items
          SET completedAt = datetime('now'), updatedAt = datetime('now')
        WHERE id = ? AND ownerId = ?`,
    ),
    move: sqlite.prepare(
      `UPDATE action_items SET dueAt = ?, updatedAt = datetime('now')
        WHERE id = ? AND ownerId = ?`,
    ),
    add: sqlite.prepare(
      `INSERT INTO action_items (id, contactId, ownerId, title, dueAt)
       VALUES (?, ?, ?, 'Follow up', ?)`,
    ),
  };
  return followUpPrepared;
}

/**
 * A follow-up date in a contact write, as the follow-up task it stands for.
 *
 * `contacts.nextFollowUpAt` is a cache that the `action_items_sync_*` triggers
 * hold at the earliest due date of the contact's open follow-ups. A write to
 * the column alone would show a follow-up no task list has, so a write never
 * sets the column:
 *
 * - A date moves the contact's earliest open follow-up to that date, or adds a
 *   "Follow up" task when it has none. The same date again changes nothing, so
 *   a contact read and written back keeps its tasks.
 * - Null completes the contact's open follow-ups.
 *
 * Runs inside the caller's transaction.
 */
function followUpTo(
  scope: Scope,
  contactIds: readonly string[],
  value: unknown,
): void {
  if (value === undefined || contactIds.length === 0) return;
  const { open, complete, move, add } = followUpStatements();
  for (const contactId of contactIds) {
    const tasks = open.all(contactId, scope.ownerId) as {
      id: string;
      dueAt: string | null;
    }[];
    if (value === null) {
      for (const task of tasks) {
        complete.run(task.id, scope.ownerId);
        recordEvent(scope, "action_item.completed", task.id, { contactId });
      }
      continue;
    }
    if (typeof value !== "string") continue;
    const earliest = tasks[0]?.dueAt != null ? tasks[0] : undefined;
    if (earliest?.dueAt === value) continue;
    if (earliest) {
      move.run(value, earliest.id, scope.ownerId);
      recordEvent(scope, "action_item.updated", earliest.id, {
        contactId,
        changed: ["dueAt"],
      });
    } else {
      const id = crypto.randomUUID();
      add.run(id, contactId, scope.ownerId, value);
      recordEvent(scope, "action_item.created", id, {
        contactId,
        interactionId: null,
      });
    }
  }
}

// Private helpers

/**
 * Map a contact body to the contacts-table insert values, for createContact and
 * bulkCreateContacts. A field not listed here never reaches the database.
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
    // Set from the follow-up task that `followUpTo` makes, by the trigger.
    nextFollowUpAt: null,
    aiSummary: body.aiSummary ?? null,
    aiBackground: body.aiBackground ?? null,
    aiBriefing: body.aiBriefing ?? null,
    aiBriefingAt: body.aiBriefingAt ?? null,
    phoneticHash: body.name ? doubleMetaphone(body.name).primary : null,
  };
}

/**
 * Keep the default face in step with the name and pronouns it was drawn from.
 * When an edit changes either and the contact still wears the default avatar
 * for its old name, the update carries the new default. A face from the picker,
 * a photo, and an edit that sets `avatarUrl` itself are left alone.
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
 * What turning tracking on means, beyond the flag. The cadence is set when a
 * contact is tracked, from the body when it names one, else from the owner's
 * default. Only rows that are untracked now take the default, so tracking
 * somebody twice, or with a cadence of their own, changes nothing. Runs inside
 * the caller's transaction, before the flag is written. The
 * `contacts_track_stamp_*` triggers write `trackedAt`.
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
 * Remove a contact's vectors and dedupe metadata. vec0 tables have no foreign
 * key cascade, so this runs on every soft and hard delete. The trash-aware
 * triggers keep the FTS rows.
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

// Geocoding

/**
 * Hand a pin back to the geocoder when the write moved its address.
 *
 * A pin placed by hand stays where the person put it, whatever else the write
 * changes. Only a change to the address the contact shows hands it back:
 * `geoSource` is cleared, and the `contacts.geocode` subscriber queues the new
 * text after the commit. Until the geocoder answers, the old coordinates stand.
 * This runs inside the write's transaction, because after the commit the
 * address before the write can no longer be read.
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

// Service

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
   * @param options.autoEnrich - True only when a person added this contact, in
   *   the app or through the REST API, so "Enrich new contacts automatically"
   *   may research it. A Google sync and an MCP client leave it unset.
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
      // The owner is spelled out at the write, not only in the value builder,
      // so a reviewer and the tenant lint can see it without following a
      // helper.
      db.insert(schema.contacts)
        .values({ ...values, ownerId: scope.ownerId })
        .run();
      contactRepo.insertChildRecords(id, body, source);
      followUpTo(scope, [id], body.nextFollowUpAt);
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
   * Write many contacts.
   *
   * With an `importId`, the rows are written in batches of `IMPORT_BATCH_ROWS`,
   * one transaction each, and the event loop runs between batches: one
   * transaction for a whole file held the database for seconds (3,000 rows kept
   * `/healthz` waiting 2.9 s). A fresh run first records every row as `pending`
   * with its payload. Each row is written under its own savepoint, and a row
   * that throws is recorded as failed, with its payload, while the rest of the
   * batch commits. The import's status moves to `imported` inside the last
   * batch's transaction, so the record never claims contacts that are not
   * there. `importService` settles a run that stops part way from its rows.
   * `rowIndexes` gives each row its line in the import, so a retry lands it
   * back where it was.
   *
   * Without an `importId` the write is one transaction, all or nothing. The
   * eval harness and the tests seed corpora this way, and a partial corpus
   * would be worse than a thrown one.
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

    // Write the contacts. The events of every committed transaction are
    // dispatched once at the end, in the cache's batch mode, so there is one
    // invalidation per tier. Batch mode is not held across the yields, where
    // other requests run.
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
        followUpTo(scope, [id], c.nextFollowUpAt);
        // Under the row's savepoint, so a row that fails takes its event
        // with it.
        recordEvent(scope, "contact.created", id, {
          origin: "import",
          autoEnrich: false,
        });
        return id;
      });

      /** Rows `start` to `end` in one transaction. */
      const txn = sqlite.transaction((start: number, end: number) => {
        for (let i = start; i < end; i++) {
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
              `Import ${importId} row ${index} failed: ${message}`,
            );
            continue;
          }
          createdIds.push(id);
          count++;
          if (importId)
            importService.rowDone(scope, importId, index, id, c.name);
        }
        // Inside the transaction on purpose. The status and the last
        // contacts commit together or not at all.
        if (importId && end === total)
          importService.markImported(scope, importId);
      });

      if (!importId) {
        txn(0, total);
      } else {
        if (!rowIndexes) {
          importService.recordPending(
            scope,
            importId,
            validContacts.map((payload, index) => ({ index, payload })),
          );
        }
        // At least one batch, so an empty import is marked imported too.
        let start = 0;
        do {
          if (start > 0) await new Promise<void>((done) => setImmediate(done));
          const end = Math.min(start + IMPORT_BATCH_ROWS, total);
          txn(start, end);
          start = end;
        } while (start < total);
      }
    } finally {
      dispatchAsBatch();
    }
    onProgress?.(total, total, "Complete");
    return { count, createdIds, failed };
  },

  /**
   * Soft-delete a batch of contacts, like deleteContact. `findManyOwned` drops
   * foreign ids first, so the count is the number of the caller's own rows that
   * moved.
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
      // buildContactUpdate returns only keys from a fixed allow list
      // (utils/helpers.ts), so only column names reach the SET clause.
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
        followUpTo(scope, changedIds, data.nextFollowUpAt);
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

      followUpTo(scope, [id], body.nextFollowUpAt);
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
    // Dedupe's phonetic blocking reads this hash, so a rename by PATCH must
    // update it, as updateContact does.
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
      followUpTo(scope, [id], body.nextFollowUpAt);
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
   * Soft-delete: move the contact to trash. The row keeps its children and can
   * be restored until purgeExpiredTrash() hard-deletes it. isArchived hides it
   * from every active surface, the trash-aware FTS triggers drop it from
   * search, and its embeddings are purged (rebuilt on restore).
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
   * Permanently delete every contact in the account's Trash ("Empty trash"),
   * in one transaction, and then their files.
   *
   * @returns how many contacts were deleted.
   */
  emptyTrash(scope: Scope): number {
    const trashed = sqlite
      .prepare(
        "SELECT id FROM contacts WHERE ownerId = ? AND deletedAt IS NOT NULL",
      )
      .all(scope.ownerId) as { id: string }[];
    const uploads: string[] = [];
    let count = 0;
    sqlite.transaction(() => {
      for (const { id } of trashed) {
        const removed = hardDeleteContact(scope, id);
        if (!removed) continue;
        count += 1;
        uploads.push(...removed);
        recordEvent(scope, "contact.deleted", id, { permanent: true });
      }
    })();
    // One event per contact: the AI cache drops each tier once, not per row.
    dispatchAsBatch();
    if (uploads.length > 0) removeUploads(scope.ownerId, uploads);
    return count;
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
    // The old photo goes only when it is in this owner's avatars folder:
    // avatarUrl is user-writable, so it may name another account's file, a
    // shared logo, or a `..` path to either.
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
   * Put the pin where a person dropped it. `geoSource = 'manual'` keeps the
   * geocoder off it: the startup sweep skips the row, and a later edit queues
   * nothing unless it changes the address the pin was read from. The edit
   * trigger skips pin columns, so this stamps updatedAt itself.
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
   * The coordinates go first, so the contact leaves the map until the geocoder
   * answers. The geocoder then reads the same text it read the first time. A
   * cached answer lands before this returns, a new one when the queue drains.
   * The geocoder call is the request itself, not a reaction to it, so it stays
   * here; the event's subscribers drop the caches. A contact with no address
   * text keeps its pin, and the request is refused.
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
          ORDER BY COALESCE(archivedAt, updatedAt) DESC`,
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

    // One subselect, six statements. The owner predicate inside it bounds every
    // child-table read below to the caller's contacts.
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
    // `interactions` is owned, so it names the owner itself. The owner-check
    // trigger keeps an interaction's owner equal to its contact's.
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
