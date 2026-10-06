// Dedupe suggestions: storing scan results, review (merge or dismiss),
// auto-merge with soft delete, and undo.
//
//   dedupe_suggestions  detected pairs, pending → merged, dismissed or
//                       auto_merged
//   dedupe_exclusions   never-merge pairs, written on dismiss
//   dedupe_merge_log    every merge, with the snapshots undo needs
//
// Pairs are stored in canonical order (contactIdA < contactIdB), and INSERT OR
// IGNORE makes a re-scan idempotent.

import crypto from "crypto";
import { sqlite, db } from "../../db.ts";
import * as schema from "../../db/schema.ts";
import { and, eq } from "drizzle-orm";
import type { Scope } from "../../tenancy/scope.ts";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { AppError, NotFoundError } from "../../utils/AppError.ts";
import { scheduleSearchIndex } from "../search/indexQueue.ts";
import type {
  ContactRow,
  HydratedContact,
  MergeConflict,
  MergeSnapshotData,
  UndoMergeResult,
} from "./types.ts";
import { UnionFind } from "../../utils/unionFind.ts";
import { recomputeLastContacted } from "../lastContacted.ts";

// Types

export interface DedupeSuggestion {
  id: string;
  contactIdA: string;
  contactIdB: string;
  matchType: string;
  confidence: number;
  reasoning: string;
  matchedField: string | null;
  /** Why to look twice before merging, or null. */
  caveat: string | null;
  status: "pending" | "auto_merged" | "merged" | "dismissed";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  // Hydrated contact data (populated by getPendingSuggestions)
  contactA?: SuggestedContact | null;
  contactB?: SuggestedContact | null;
}

/**
 * A contact as a suggestion carries it: the whole contact, and how many open
 * follow-ups it has, so the review can say what a merge moves.
 */
export type SuggestedContact = HydratedContact & { openFollowUpCount: number };

export interface MergeLogEntry {
  id: string;
  primaryId: string;
  duplicateId: string;
  mergedBy: string; // 'user' | 'auto' | 'user:suggestion'
  mergeType: string; // 'soft'. Older rows may hold 'hard'.
  confidence: number;
  reasoning: string;
  mergedAt: string;
  undoneAt: string | null;
  duplicateSnapshot: string | null;
  // Hydrated fields (populated by getMergeLog). The company and the city
  // tell two entries with one name apart.
  primaryName?: string;
  duplicateName?: string;
  primaryCompany?: string | null;
  primaryLocation?: string | null;
  duplicateCompany?: string | null;
  duplicateLocation?: string | null;
}

/** Where a merged-away contact lives now, for its old page and its notice. */
export interface MergedInto {
  /** The merge that hid it, for Undo. Null for a merge with no log row. */
  mergeLogId: string | null;
  /** The live contact at the end of its merge chain. */
  primaryId: string;
  primaryName: string;
  mergedBy: "auto" | "user";
  mergedAt: string;
}

// Prepared statements

/**
 * The contacts that can still be one half of a pending pair: not merged away,
 * not in the Trash and not archived. A ghost counts, because a note's ghost
 * waits beside the contact it may be ("Mentioned in a note"). Takes the owner
 * as its one parameter.
 */
const LIVE_CONTACTS = `SELECT id FROM contacts
   WHERE ownerId = ? AND canonicalId IS NULL AND deletedAt IS NULL
     AND (isArchived = 0 OR isArchived IS NULL)`;

/** A pending pair whose two contacts are both live. Two owner parameters. */
const LIVE_PAIR = `contactIdA IN (${LIVE_CONTACTS}) AND contactIdB IN (${LIVE_CONTACTS})`;

const _stmts = {
  // A suggestion, an exclusion and a merge log row name their owner on insert.
  // The fill trigger could derive it from `contactIdA`, but the pair check that
  // makes it right lives in this service.
  insertSuggestion: sqlite.prepare(`
    INSERT OR IGNORE INTO dedupe_suggestions
      (id, contactIdA, contactIdB, matchType, confidence, reasoning, matchedField, status, ownerId, caveat)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // A pair can outlive one of its contacts between two cleanups, when the
  // contact goes to the Trash or the archive, so every pending read asks for
  // live pairs.
  getPending: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending' AND ${LIVE_PAIR}
    ORDER BY confidence DESC
    LIMIT ?
  `),

  getPendingCount: sqlite.prepare(`
    SELECT COUNT(*) AS cnt FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending' AND ${LIVE_PAIR}
  `),

  getPendingPairs: sqlite.prepare(`
    SELECT contactIdA, contactIdB FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending' AND ${LIVE_PAIR}
  `),

  getById: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions WHERE id = ? AND ownerId = ?
  `),

  getForContact: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions
    WHERE ownerId = ? AND (contactIdA = ? OR contactIdB = ?) AND status = 'pending'
      AND ${LIVE_PAIR}
    ORDER BY confidence DESC
    LIMIT 1
  `),

  updateStatus: sqlite.prepare(`
    UPDATE dedupe_suggestions
    SET status = ?, reviewedAt = CURRENT_TIMESTAMP, reviewedBy = ?
    WHERE id = ? AND ownerId = ?
  `),

  clearStale: sqlite.prepare(`
    DELETE FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending' AND NOT (${LIVE_PAIR})
  `),

  // A scan writes every pair it finds again, so it clears the old ones first.
  // Not a note's pairs: a scan never finds them, so clearing them would lose a
  // ghost's "Mentioned in a note" review.
  clearAllPending: sqlite.prepare(`
    DELETE FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending' AND matchType != 'mention'
  `),

  /** The pair a merge just joined, settled with it. */
  settlePair: sqlite.prepare(`
    UPDATE dedupe_suggestions
    SET status = ?, reviewedAt = CURRENT_TIMESTAMP, reviewedBy = ?
    WHERE ownerId = ? AND status = 'pending'
      AND contactIdA = ? AND contactIdB = ?
  `),

  /** The pair an undo keeps apart: never merged or suggested again. */
  dismissPair: sqlite.prepare(`
    UPDATE dedupe_suggestions
    SET status = 'dismissed', reviewedAt = CURRENT_TIMESTAMP, reviewedBy = 'user:undo'
    WHERE ownerId = ? AND contactIdA = ? AND contactIdB = ?
  `),

  /** A dismissed suggestion back in the review. */
  restoreSuggestion: sqlite.prepare(`
    UPDATE dedupe_suggestions
    SET status = 'pending', reviewedAt = NULL, reviewedBy = NULL
    WHERE id = ? AND ownerId = ? AND status = 'dismissed'
  `),

  deleteExclusion: sqlite.prepare(`
    DELETE FROM dedupe_exclusions
    WHERE ownerId = ? AND contactIdA = ? AND contactIdB = ?
  `),

  /** Whether one contact is live, as `LIVE_CONTACTS` defines it. */
  isLive: sqlite.prepare(`
    SELECT 1 FROM contacts
    WHERE id = ? AND ownerId = ? AND canonicalId IS NULL AND deletedAt IS NULL
      AND (isArchived = 0 OR isArchived IS NULL)
  `),

  canonicalOf: sqlite.prepare(`
    SELECT canonicalId, updatedAt FROM contacts WHERE id = ? AND ownerId = ?
  `),

  /** The latest merge that hid a contact and is not undone. */
  latestMergeOf: sqlite.prepare(`
    SELECT id, mergedBy, mergedAt FROM dedupe_merge_log
    WHERE ownerId = ? AND duplicateId = ? AND undoneAt IS NULL
    ORDER BY mergedAt DESC, rowid DESC
    LIMIT 1
  `),

  // Exclusions
  insertExclusion: sqlite.prepare(`
    INSERT OR IGNORE INTO dedupe_exclusions (contactIdA, contactIdB, ownerId)
    VALUES (?, ?, ?)
  `),

  // Merge Log
  insertMergeLog: sqlite.prepare(`
    INSERT INTO dedupe_merge_log
      (id, primaryId, duplicateId, mergedBy, mergeType, confidence, reasoning, duplicateSnapshot, ownerId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getMergeLog: sqlite.prepare(`
    SELECT * FROM dedupe_merge_log
    WHERE ownerId = ?
    ORDER BY mergedAt DESC
    LIMIT ?
  `),

  getMergeLogById: sqlite.prepare(`
    SELECT * FROM dedupe_merge_log WHERE id = ? AND ownerId = ?
  `),

  undoMergeLog: sqlite.prepare(`
    UPDATE dedupe_merge_log SET undoneAt = CURRENT_TIMESTAMP
    WHERE id = ? AND ownerId = ?
  `),

  restoreDuplicate: sqlite.prepare(`
    UPDATE contacts SET canonicalId = NULL WHERE id = ? AND ownerId = ?
  `),

  /** One contact's name, company and city, for the merge log. */
  contactName: sqlite.prepare(`
    SELECT name, company, location FROM contacts WHERE id = ? AND ownerId = ?
  `),

  reopenSuggestion: sqlite.prepare(`
    UPDATE dedupe_suggestions
    SET status = 'pending', reviewedAt = NULL, reviewedBy = NULL
    WHERE ownerId = ?
      AND ((contactIdA = ? AND contactIdB = ?) OR (contactIdA = ? AND contactIdB = ?))
      AND status IN ('auto_merged', 'user_merged', 'merged')
  `),
};

// Suggestions

/**
 * Store one suggestion in canonical pair order (A < B). INSERT OR IGNORE makes
 * a re-scan safe.
 */
export function storeSuggestion(
  scope: Scope,
  pair: {
    idA: string;
    idB: string;
    matchType: string;
    confidence: number;
    reasoning: string;
    matchedField?: string;
    caveat?: string | null;
  },
  status: "pending" | "auto_merged",
): void {
  const [a, b] =
    pair.idA < pair.idB ? [pair.idA, pair.idB] : [pair.idB, pair.idA];
  _stmts.insertSuggestion.run(
    crypto.randomUUID(),
    a,
    b,
    pair.matchType,
    pair.confidence,
    pair.reasoning,
    pair.matchedField ?? null,
    status,
    scope.ownerId,
    pair.caveat ?? null,
  );
}

/** Store many suggestions in one transaction, at the end of a scan. */
export function storeSuggestions(
  scope: Scope,
  pairs: {
    idA: string;
    idB: string;
    matchType: string;
    confidence: number;
    reasoning: string;
    matchedField?: string;
    caveat?: string | null;
  }[],
  status: "pending" | "auto_merged",
): void {
  if (pairs.length === 0) return;

  const txn = sqlite.transaction(() => {
    for (const pair of pairs) {
      const [a, b] =
        pair.idA < pair.idB ? [pair.idA, pair.idB] : [pair.idB, pair.idA];
      _stmts.insertSuggestion.run(
        crypto.randomUUID(),
        a,
        b,
        pair.matchType,
        pair.confidence,
        pair.reasoning,
        pair.matchedField ?? null,
        status,
        scope.ownerId,
        pair.caveat ?? null,
      );
    }
  });
  txn();
}

/**
 * Pending suggestions with both contacts, highest confidence first.
 *
 * @param limit - Max suggestions to return (default 100)
 */
export function getPendingSuggestions(
  scope: Scope,
  limit: number = 100,
): DedupeSuggestion[] {
  const rows = _stmts.getPending.all(
    scope.ownerId,
    scope.ownerId,
    scope.ownerId,
    limit,
  ) as DedupeSuggestion[];
  if (!rows.length) return rows;

  // Hydrate every contact the rows name in one IN(...) query, not about 26
  // queries per suggestion.
  try {
    const ids = [...new Set(rows.flatMap((r) => [r.contactIdA, r.contactIdB]))];
    const hydrated = suggestedContacts(scope, ids);
    for (const row of rows) {
      row.contactA = hydrated.get(row.contactIdA) ?? row.contactA;
      row.contactB = hydrated.get(row.contactIdB) ?? row.contactB;
    }
  } catch (err) {
    // Contact may have been deleted mid-read — leave fields undefined
    log.warn("Dedupe", `Suggestion hydration failed: ${String(err)}`);
  }

  return rows;
}

/**
 * Contacts as a suggestion carries them, by id: hydrated, with the count of
 * open follow-ups a merge would move.
 */
function suggestedContacts(
  scope: Scope,
  ids: string[],
): Map<string, SuggestedContact> {
  const contacts = contactRepo.hydrateMany(
    contactRepo.findManyOwned(scope, ids),
  );
  if (contacts.length === 0) return new Map();
  const counts = new Map(
    (
      sqlite
        .prepare(
          `SELECT contactId, COUNT(*) AS n FROM action_items
            WHERE ownerId = ? AND completedAt IS NULL
              AND contactId IN (${contacts.map(() => "?").join(", ")})
            GROUP BY contactId`,
        )
        .all(scope.ownerId, ...contacts.map((c) => c.id)) as {
        contactId: string;
        n: number;
      }[]
    ).map((row) => [row.contactId, row.n]),
  );
  return new Map(
    contacts.map((c) => [
      c.id,
      { ...c, openFollowUpCount: counts.get(c.id) ?? 0 },
    ]),
  );
}

/** Get the count of pending suggestions (for sidebar badge). */
export function getPendingCount(scope: Scope): number {
  return (
    _stmts.getPendingCount.get(scope.ownerId, scope.ownerId, scope.ownerId) as {
      cnt: number;
    }
  ).cnt;
}

/**
 * The number of review cards the Duplicates page shows.
 *
 * The review groups pending pairs into clusters with union-find, because (A,B)
 * and (B,C) are one problem with three contacts. The badge counts clusters too,
 * so it agrees with the page. The pending set is tens of rows.
 *
 * @returns the count of connected groups among pending suggestions
 */
export function getPendingClusterCount(scope: Scope): number {
  const pairs = _stmts.getPendingPairs.all(
    scope.ownerId,
    scope.ownerId,
    scope.ownerId,
  ) as {
    contactIdA: string;
    contactIdB: string;
  }[];
  if (pairs.length === 0) return 0;

  const uf = new UnionFind();
  for (const pair of pairs) uf.union(pair.contactIdA, pair.contactIdB);
  return uf.getClusters().size;
}

/** One of this account's suggestions by id, or null. */
export function getSuggestionById(
  scope: Scope,
  id: string,
): DedupeSuggestion | null {
  const row = _stmts.getById.get(id, scope.ownerId) as
    DedupeSuggestion | undefined;
  if (!row) return null;
  hydratePair(scope, row);
  return row;
}

/**
 * Attach both contacts to a suggestion row. The pair check that wrote the row
 * proved both contacts share its owner, so a scoped read finds them unless one
 * has been merged away since.
 */
function hydratePair(scope: Scope, row: DedupeSuggestion): void {
  try {
    const hydrated = suggestedContacts(scope, [row.contactIdA, row.contactIdB]);
    row.contactA = hydrated.get(row.contactIdA) ?? row.contactA;
    row.contactB = hydrated.get(row.contactIdB) ?? row.contactB;
  } catch {
    // Contact may have been deleted
  }
}

/** A pending suggestion that names a contact, for the banner on its page. */
export function getSuggestionForContact(
  scope: Scope,
  contactId: string,
): DedupeSuggestion | null {
  const row = _stmts.getForContact.get(
    scope.ownerId,
    contactId,
    contactId,
    scope.ownerId,
    scope.ownerId,
  ) as DedupeSuggestion | undefined;
  if (!row) return null;
  hydratePair(scope, row);
  return row;
}

// Suggestion actions

/**
 * Dismiss a suggestion and add the pair to the exclusions, so no scan suggests
 * it again.
 */
export function dismissSuggestion(scope: Scope, id: string, rid: string): void {
  const suggestion = _stmts.getById.get(id, scope.ownerId) as
    DedupeSuggestion | undefined;
  if (!suggestion) {
    throw new AppError(`Suggestion ${id} not found`, 404, {
      code: "NOT_FOUND",
    });
  }
  if (suggestion.status !== "pending") {
    throw new AppError(
      `Suggestion ${id} is already ${suggestion.status}`,
      409,
      {
        code: "CONFLICT",
        details: { currentStatus: suggestion.status },
      },
    );
  }

  const txn = sqlite.transaction(() => {
    // 1. Mark suggestion as dismissed
    _stmts.updateStatus.run("dismissed", "user", id, scope.ownerId);

    // 2. Add to exclusions (canonical ordering already enforced by storage)
    _stmts.insertExclusion.run(
      suggestion.contactIdA,
      suggestion.contactIdB,
      scope.ownerId,
    );
  });
  txn();

  log.info(
    "DedupeSuggestions",
    `[${rid}] Dismissed suggestion ${id} (${suggestion.contactIdA} ↔ ${suggestion.contactIdB})`,
  );
}

/**
 * Mark a suggestion merged, after the merge itself ran.
 *
 * @param mergedBy - Who merged: 'user', 'auto', or 'user:suggestion'
 */
export function markSuggestionMerged(
  scope: Scope,
  id: string,
  mergedBy: string,
): void {
  const status = mergedBy === "auto" ? "auto_merged" : "merged";
  _stmts.updateStatus.run(status, mergedBy, id, scope.ownerId);
}

// Merge log

/**
 * INTERNAL: the caller must hold a transaction. `mergeContacts` and
 * `softMergeContacts` write the log row in the same transaction as the merge,
 * so a merge can never commit without the row that `undoSoftMerge` needs.
 */
export function recordMergeUnsafe(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
  confidence: number,
  reasoning: string,
  mergedBy: string,
  mergeType: "soft",
  snapshot?: string | null,
): string {
  const id = crypto.randomUUID();
  // The owner is the caller's: `mergeContacts` proved both contacts belong to
  // this account before it touched a child row.
  _stmts.insertMergeLog.run(
    id,
    primaryId,
    duplicateId,
    mergedBy,
    mergeType,
    confidence,
    reasoning,
    snapshot ?? null,
    scope.ownerId,
  );
  log.info(
    "DedupeSuggestions",
    `Merge log: ${mergeType} merge of ${duplicateId} → ${primaryId} (by ${mergedBy}, confidence ${(confidence * 100).toFixed(0)}%)`,
  );
  return id;
}

/**
 * The merge log, most recent first.
 *
 * @param limit - Max entries to return (default 50)
 */
export function getMergeLog(scope: Scope, limit: number = 50): MergeLogEntry[] {
  const rows = _stmts.getMergeLog.all(scope.ownerId, limit) as MergeLogEntry[];

  // Hydrate names, companies and cities for display. The duplicate is still
  // a row while it is merged away, and keeps its own fields.
  type Named = {
    name: string;
    company: string | null;
    location: string | null;
  };
  for (const row of rows) {
    try {
      const primary = _stmts.contactName.get(row.primaryId, scope.ownerId) as
        Named | undefined;
      const duplicate = _stmts.contactName.get(
        row.duplicateId,
        scope.ownerId,
      ) as Named | undefined;
      row.primaryName = primary?.name ?? "(deleted)";
      row.duplicateName = duplicate?.name ?? "(deleted)";
      row.primaryCompany = primary?.company ?? null;
      row.primaryLocation = primary?.location ?? null;
      row.duplicateCompany = duplicate?.company ?? null;
      row.duplicateLocation = duplicate?.location ?? null;
    } catch {
      row.primaryName = "(unknown)";
      row.duplicateName = "(unknown)";
    }
  }

  return rows;
}

/** The child tables a merge moves rows in. Undo writes rows back to these. */
const CHILD_TABLES = new Set([
  "contact_emails",
  "contact_phones",
  "contact_addresses",
  "contact_social_links",
  "contact_education",
  "contact_experience",
  "contact_sources",
  "contact_tags",
  "contact_interests",
  "contact_attributes",
  "interactions",
  "action_items",
]);

/** The columns each child table has now, read once from the database. */
const childColumns = new Map<string, Set<string>>();

function columnsOf(table: string): Set<string> {
  let columns = childColumns.get(table);
  if (!columns) {
    const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    columns = new Set(info.map((column) => column.name));
    childColumns.set(table, columns);
  }
  return columns;
}

/**
 * Write a child row from a merge snapshot back onto a contact. The snapshot
 * holds the row as `SELECT *` returned it, so this copies the row's columns and
 * skips any the table no longer has. It sets the contact, and the owner when
 * the table has one.
 *
 * @param table - One of the child tables in `CHILD_TABLES`.
 * @param row - The row from the snapshot.
 * @param targetContactId - The contact that receives the row.
 * @param scope - The signed-in account, which owns the restored row.
 * @param newId - A new row id. The row keeps its old id when this is absent.
 */
function restoreChildRow(
  table: string,
  row: Record<string, unknown>,
  targetContactId: string,
  scope: Scope,
  newId?: string,
) {
  if (!CHILD_TABLES.has(table)) {
    throw new Error(`Undo cannot restore a row of ${table}`);
  }
  const columns = columnsOf(table);
  const values: Record<string, unknown> = {
    ...row,
    id: newId ?? row.id,
    contactId: targetContactId,
  };
  if (columns.has("ownerId")) values.ownerId = scope.ownerId;
  const names = Object.keys(values).filter((name) => columns.has(name));
  sqlite
    .prepare(
      `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    )
    .run(...names.map((name) => values[name] ?? null));
}

function isChildRowModified(
  table: string,
  currentRow: Record<string, unknown>,
  originalRow: Record<string, unknown>,
): boolean {
  const compareKeys: Record<string, string[]> = {
    contact_emails: ["email", "label"],
    contact_phones: ["phone", "label"],
    contact_addresses: ["address", "label"],
    contact_social_links: ["platform", "url"],
    contact_education: [
      "school",
      "degree",
      "fieldOfStudy",
      "startDate",
      "endDate",
      "description",
    ],
    contact_experience: [
      "company",
      "role",
      "location",
      "description",
      "startDate",
      "endDate",
      "isCurrent",
    ],
    contact_sources: ["platform", "externalId"],
    contact_tags: ["tag"],
    contact_interests: ["interest"],
    contact_attributes: ["name", "value"],
    interactions: ["type", "title", "content", "date"],
  };
  const keys = compareKeys[table] ?? [];
  for (const k of keys) {
    const cur = (currentRow[k] ?? "") + "";
    const orig = (originalRow[k] ?? "") + "";
    if (cur !== orig) return true;
  }
  return false;
}

/**
 * Undo a merge: show the duplicate again, move back the records the survivor
 * has not changed since, keep its later edits, recompute follow-ups, and report
 * any conflicts.
 *
 * `keepSeparate`, true unless the caller says otherwise, also records the two
 * as different people, like "Keep separate": an undo that only reopened the
 * pair would be merged again by the next scan. The browser sends false for the
 * Undo right after a person's own merge, a slip of the key, which puts the pair
 * back in the review.
 *
 * @throws Error if the merge log entry is not found or already undone
 */
export function undoSoftMerge(
  scope: Scope,
  mergeLogId: string,
  rid: string,
  options: { keepSeparate?: boolean } = {},
): UndoMergeResult {
  const keepSeparate = options.keepSeparate ?? true;
  const entry = _stmts.getMergeLogById.get(mergeLogId, scope.ownerId) as
    MergeLogEntry | undefined;

  if (!entry) {
    throw new AppError(`Merge log entry ${mergeLogId} not found`, 404, {
      code: "NOT_FOUND",
    });
  }
  if (entry.undoneAt) {
    throw new AppError(
      `Merge ${mergeLogId} was already undone at ${entry.undoneAt}`,
      409,
      {
        code: "ALREADY_UNDONE",
        details: { undoneAt: entry.undoneAt },
      },
    );
  }

  // Check duplicate contact exists
  const duplicate = contactRepo.findOwned(scope, entry.duplicateId);

  if (!duplicate) {
    throw new AppError(
      `Duplicate contact ${entry.duplicateId} no longer exists — cannot undo`,
      410,
      {
        code: "GONE",
      },
    );
  }
  if (!duplicate.canonicalId) {
    throw new AppError(
      `Duplicate contact ${entry.duplicateId} is not soft-merged (canonicalId is NULL)`,
      409,
      {
        code: "INVALID_STATE",
      },
    );
  }

  const conflicts: MergeConflict[] = [];

  // The saved copy is read before anything changes. Without it an undo would
  // show the contact again with nothing on it, so it refuses.
  let snapshot: MergeSnapshotData | null = null;
  if (entry.duplicateSnapshot) {
    try {
      snapshot = JSON.parse(entry.duplicateSnapshot) as MergeSnapshotData;
    } catch {
      throw new AppError(
        "This merge cannot be undone: its saved copy of the contact cannot be read",
        409,
        { code: "SNAPSHOT_UNREADABLE" },
      );
    }
  }

  // All or nothing: a step that throws rolls every step back, and the merge
  // stays as it was.
  const txn = sqlite.transaction(() => {
    if (snapshot) {
      // 1. Reverse child tables
      const childTableMapping: Record<
        keyof MergeSnapshotData["changes"]["movedRecords"],
        { table: string; snapshotKey: keyof MergeSnapshotData["duplicate"] }
      > = {
        emails: { table: "contact_emails", snapshotKey: "emails" },
        phones: { table: "contact_phones", snapshotKey: "phones" },
        addresses: { table: "contact_addresses", snapshotKey: "addresses" },
        socialLinks: {
          table: "contact_social_links",
          snapshotKey: "socialLinks",
        },
        education: { table: "contact_education", snapshotKey: "education" },
        experience: {
          table: "contact_experience",
          snapshotKey: "experience",
        },
        sources: { table: "contact_sources", snapshotKey: "sources" },
        tags: { table: "contact_tags", snapshotKey: "tags" },
        interests: { table: "contact_interests", snapshotKey: "interests" },
        attributes: {
          table: "contact_attributes",
          snapshotKey: "attributes",
        },
        interactions: { table: "interactions", snapshotKey: "interactions" },
        actionItems: { table: "action_items", snapshotKey: "actionItems" },
      };

      for (const [key, mapping] of Object.entries(childTableMapping) as [
        keyof MergeSnapshotData["changes"]["movedRecords"],
        { table: string; snapshotKey: keyof MergeSnapshotData["duplicate"] },
      ][]) {
        if (key === "actionItems") {
          // Action items handled separately below for follow-up date calculation
          continue;
        }
        const movedIds = snapshot.changes?.movedRecords?.[key] ?? [];
        const originalList = (snapshot.duplicate[mapping.snapshotKey] ??
          []) as Record<string, unknown>[];
        const originalMap = new Map<string, Record<string, unknown>>(
          originalList.map((r) => [r.id as string, r]),
        );

        for (const recId of movedIds) {
          const originalRow = originalMap.get(recId);
          const currentRow = (
            mapping.table === "interactions"
              ? sqlite
                  .prepare(
                    // tenant-lint: allow owner-checked by caller
                    "SELECT * FROM interactions WHERE id = ? AND ownerId = ?",
                  )
                  .get(recId, scope.ownerId)
              : sqlite
                  .prepare(`SELECT * FROM ${mapping.table} WHERE id = ?`)
                  .get(recId)
          ) as Record<string, unknown> | undefined;

          if (!currentRow) {
            // Deleted from survivor
            if (originalRow) {
              restoreChildRow(
                mapping.table,
                originalRow,
                entry.duplicateId,
                scope,
              );
              conflicts.push({
                type: "record_deleted",
                entity: mapping.table,
                id: recId,
                message: `${mapping.table} record was deleted from survivor after merge. Restored original to duplicate.`,
              });
            }
          } else if (currentRow.contactId !== entry.primaryId) {
            // Moved elsewhere
            if (originalRow) {
              const freshId = crypto.randomUUID();
              restoreChildRow(
                mapping.table,
                originalRow,
                entry.duplicateId,
                scope,
                freshId,
              );
              conflicts.push({
                type: "record_edited",
                entity: mapping.table,
                id: recId,
                message: `${mapping.table} record was moved away from survivor. Restored copy to duplicate.`,
              });
            }
          } else {
            // Record is still on primary: check if modified
            if (
              originalRow &&
              isChildRowModified(mapping.table, currentRow, originalRow)
            ) {
              // Keep edited row on primary, restore original copy to duplicate with fresh UUID
              const freshId = crypto.randomUUID();
              restoreChildRow(
                mapping.table,
                originalRow,
                entry.duplicateId,
                scope,
                freshId,
              );
              conflicts.push({
                type: "record_edited",
                entity: mapping.table,
                id: recId,
                message: `${mapping.table} record was modified on survivor after merge. Survivor retains edit; original restored to duplicate.`,
              });
            } else {
              // Unchanged: move back to duplicate!
              if (mapping.table === "interactions") {
                sqlite
                  .prepare(
                    // tenant-lint: allow owner-checked by caller
                    "UPDATE interactions SET contactId = ? WHERE id = ? AND ownerId = ?",
                  )
                  .run(entry.duplicateId, recId, scope.ownerId);
              } else if (columnsOf(mapping.table).has("isPrimary")) {
                // The merge took the primary mark off an email or phone that
                // joined a contact with one. Back home, it is the duplicate's
                // primary again.
                sqlite
                  .prepare(
                    `UPDATE ${mapping.table} SET contactId = ?, isPrimary = ? WHERE id = ?`,
                  )
                  .run(
                    entry.duplicateId,
                    originalRow?.isPrimary ? 1 : 0,
                    recId,
                  );
              } else {
                sqlite
                  .prepare(
                    `UPDATE ${mapping.table} SET contactId = ? WHERE id = ?`,
                  )
                  .run(entry.duplicateId, recId);
              }
            }
          }
        }
      }

      // 2. Action items
      const movedActionItemIds =
        snapshot.changes?.movedRecords?.actionItems ?? [];
      const originalActionItems = snapshot.duplicate?.actionItems ?? [];
      const origTaskMap = new Map<string, Record<string, unknown>>(
        originalActionItems.map((a) => [a.id as string, a]),
      );

      for (const taskId of movedActionItemIds) {
        const originalTask = origTaskMap.get(taskId);
        const currentTask = sqlite
          .prepare("SELECT * FROM action_items WHERE id = ? AND ownerId = ?")
          .get(taskId, scope.ownerId) as Record<string, unknown> | undefined;

        if (!currentTask) {
          // Task deleted from survivor
          if (originalTask) {
            restoreChildRow(
              "action_items",
              originalTask,
              entry.duplicateId,
              scope,
            );
            conflicts.push({
              type: "record_deleted",
              entity: "action_items",
              id: taskId,
              message:
                "Follow-up task was deleted from survivor after merge. Restored to duplicate.",
            });
          }
        } else if (currentTask.contactId !== entry.primaryId) {
          // Task moved elsewhere
          if (originalTask) {
            const freshId = crypto.randomUUID();
            restoreChildRow(
              "action_items",
              originalTask,
              entry.duplicateId,
              scope,
              freshId,
            );
            conflicts.push({
              type: "record_edited",
              entity: "action_items",
              id: taskId,
              message:
                "Follow-up task was moved away from survivor. Restored copy to duplicate.",
            });
          }
        } else if (currentTask.completedAt && !originalTask?.completedAt) {
          // Task was completed on survivor!
          const freshId = crypto.randomUUID();
          restoreChildRow(
            "action_items",
            originalTask!,
            entry.duplicateId,
            scope,
            freshId,
          );
          conflicts.push({
            type: "task_completed",
            entity: "action_items",
            id: taskId,
            message:
              "Follow-up task was completed on survivor after merge. Survivor retains completed task; restored pending task on duplicate.",
          });
        } else if (
          originalTask &&
          (currentTask.title !== originalTask.title ||
            currentTask.dueAt !== originalTask.dueAt)
        ) {
          // Task was edited on survivor!
          const freshId = crypto.randomUUID();
          restoreChildRow(
            "action_items",
            originalTask,
            entry.duplicateId,
            scope,
            freshId,
          );
          conflicts.push({
            type: "record_edited",
            entity: "action_items",
            id: taskId,
            message:
              "Follow-up task was edited on survivor after merge. Survivor retains edit; original restored to duplicate.",
          });
        } else {
          // Unchanged: move back to duplicate!
          sqlite
            .prepare(
              "UPDATE action_items SET contactId = ? WHERE id = ? AND ownerId = ?",
            )
            .run(entry.duplicateId, taskId, scope.ownerId);
        }
      }

      // Recompute nextFollowUpAt for BOTH primary and duplicate
      sqlite
        .prepare(
          `UPDATE contacts SET nextFollowUpAt = (
               SELECT MIN(dueAt) FROM action_items
               WHERE contactId = ? AND ownerId = ? AND completedAt IS NULL
             ) WHERE id = ? AND ownerId = ?`,
        )
        .run(entry.primaryId, scope.ownerId, entry.primaryId, scope.ownerId);

      sqlite
        .prepare(
          `UPDATE contacts SET nextFollowUpAt = (
               SELECT MIN(dueAt) FROM action_items
               WHERE contactId = ? AND ownerId = ? AND completedAt IS NULL
             ) WHERE id = ? AND ownerId = ?`,
        )
        .run(
          entry.duplicateId,
          scope.ownerId,
          entry.duplicateId,
          scope.ownerId,
        );

      // 3. Mentions
      for (const mid of snapshot.changes?.movedMentions ?? []) {
        sqlite
          .prepare(
            "UPDATE interaction_mentions SET contactId = ? WHERE contactId = ? AND interactionId = ?",
          )
          .run(entry.duplicateId, entry.primaryId, mid);
      }
      for (const mid of snapshot.changes?.deletedMentions ?? []) {
        sqlite
          .prepare(
            "INSERT OR IGNORE INTO interaction_mentions (interactionId, contactId) VALUES (?, ?)",
          )
          .run(mid, entry.duplicateId);
      }

      // 4. Scalar fields
      const currentPrimary = sqlite
        .prepare("SELECT * FROM contacts WHERE id = ? AND ownerId = ?")
        .get(entry.primaryId, scope.ownerId) as
        Record<string, unknown> | undefined;

      if (currentPrimary && snapshot.changes?.scalarUpdates) {
        const scalarReverts: Record<string, unknown> = {};
        for (const [field, { oldValue, transferredValue }] of Object.entries(
          snapshot.changes.scalarUpdates,
        )) {
          const curr = currentPrimary[field];
          if (curr === transferredValue) {
            scalarReverts[field] = oldValue;
          } else {
            conflicts.push({
              type: "scalar_edited",
              entity: "contacts",
              field,
              currentValue: curr,
              oldValue,
              duplicateValue: transferredValue,
              message: `Contact field '${field}' was edited on survivor after merge. Survivor retained value '${curr}'.`,
            });
          }
        }
        if (snapshot.changes.addedAtUpdated) {
          if (
            currentPrimary.addedAt ===
            snapshot.changes.addedAtUpdated.newAddedAt
          ) {
            scalarReverts.addedAt = snapshot.changes.addedAtUpdated.oldAddedAt;
          }
        }
        if (Object.keys(scalarReverts).length > 0) {
          scalarReverts.updatedAt = new Date().toISOString();
          db.update(schema.contacts)
            .set(scalarReverts as Partial<ContactRow>)
            .where(
              and(
                eq(schema.contacts.id, entry.primaryId),
                eq(schema.contacts.ownerId, scope.ownerId),
              ),
            )
            .run();
        }
      }

      // 5. List memberships
      for (const listId of snapshot.changes?.addedListIds ?? []) {
        sqlite
          .prepare(
            "DELETE FROM list_members WHERE listId = ? AND contactId = ?",
          )
          .run(listId, entry.primaryId);
        sqlite
          .prepare(
            "INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)",
          )
          .run(listId, entry.duplicateId);
      }
    }

    // `lastContactedAt` follows the interactions that moved back, on both.
    recomputeLastContacted(scope, [entry.primaryId, entry.duplicateId]);

    // 6. Restore the duplicate contact's visibility
    _stmts.restoreDuplicate.run(entry.duplicateId, scope.ownerId);

    // 7. Mark the merge log entry as undone
    _stmts.undoMergeLog.run(mergeLogId, scope.ownerId);

    // 8. The pair: kept apart for good, or back in the review.
    if (keepSeparate) {
      const [low, high] =
        entry.primaryId < entry.duplicateId
          ? [entry.primaryId, entry.duplicateId]
          : [entry.duplicateId, entry.primaryId];
      _stmts.insertExclusion.run(low, high, scope.ownerId);
      _stmts.dismissPair.run(scope.ownerId, low, high);
    } else {
      _stmts.reopenSuggestion.run(
        scope.ownerId,
        entry.primaryId,
        entry.duplicateId,
        entry.duplicateId,
        entry.primaryId,
      );
    }
  });

  txn();

  scheduleSearchIndex(entry.primaryId);
  scheduleSearchIndex(entry.duplicateId);

  log.info(
    "DedupeSuggestions",
    `[${rid}] Undone merge ${mergeLogId}: restored ${entry.duplicateId} (was merged into ${entry.primaryId}) with ${conflicts.length} conflict(s)${keepSeparate ? ", kept separate" : ""}`,
  );

  return {
    restoredContactId: entry.duplicateId,
    conflicts,
    keptSeparate: keepSeparate,
  };
}

// After a merge, and the contact a merged one became

/**
 * Settle the suggestions a merge changed. INTERNAL: the caller holds the
 * merge's transaction. The joined pair is marked merged, and every other
 * pending pair that names a contact no longer live goes. Every merge path runs
 * this, so no pair waits in the review for a contact merged away.
 */
export function settleSuggestionsAfterMergeUnsafe(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
  mergedBy: "user" | "auto",
): void {
  const [low, high] =
    primaryId < duplicateId
      ? [primaryId, duplicateId]
      : [duplicateId, primaryId];
  _stmts.settlePair.run(
    mergedBy === "auto" ? "auto_merged" : "merged",
    mergedBy,
    scope.ownerId,
    low,
    high,
  );
  clearStaleSuggestions(scope);
}

/**
 * The contact a contact lives on now: itself while it is not merged away, or
 * the end of its merge chain. Null when the contact, or a contact in its
 * chain, is gone. Twenty steps at most, so a corrupt cycle cannot hang a
 * request.
 */
export function liveContactId(scope: Scope, contactId: string): string | null {
  let id = contactId;
  for (let step = 0; step < 20; step++) {
    const row = _stmts.canonicalOf.get(id, scope.ownerId) as
      { canonicalId: string | null } | undefined;
    if (!row) return null;
    if (!row.canonicalId) return id;
    id = row.canonicalId;
  }
  return null;
}

/**
 * Where a merged-away contact lives now, or null while it is live.
 *
 * @throws NotFoundError for a contact this account does not have, so an old
 *   link to somebody else's contact reads the same as a link to nothing.
 */
export function getMergedInto(
  scope: Scope,
  contactId: string,
): MergedInto | null {
  const row = _stmts.canonicalOf.get(contactId, scope.ownerId) as
    { canonicalId: string | null; updatedAt: string | null } | undefined;
  if (!row) throw new NotFoundError("Contact");
  if (!row.canonicalId) return null;

  const primaryId = liveContactId(scope, contactId);
  if (!primaryId) return null;
  const primary = _stmts.contactName.get(primaryId, scope.ownerId) as
    { name: string } | undefined;
  if (!primary) return null;

  const merge = _stmts.latestMergeOf.get(scope.ownerId, contactId) as
    { id: string; mergedBy: string; mergedAt: string } | undefined;
  return {
    mergeLogId: merge?.id ?? null,
    primaryId,
    primaryName: primary.name,
    mergedBy: merge?.mergedBy.startsWith("auto") ? "auto" : "user",
    mergedAt: merge?.mergedAt ?? row.updatedAt ?? "",
  };
}

/**
 * Put a pair a person kept separate back in the review: the Undo of "Keep
 * separate". The exclusion goes with it, so scans see the pair again.
 *
 * @throws 404 for an unknown suggestion or another account's, 409 when it is
 *   not dismissed or one of its contacts is no longer live.
 */
export function restoreSuggestion(scope: Scope, id: string, rid: string): void {
  const suggestion = _stmts.getById.get(id, scope.ownerId) as
    DedupeSuggestion | undefined;
  if (!suggestion) {
    throw new AppError(`Suggestion ${id} not found`, 404, {
      code: "NOT_FOUND",
    });
  }
  if (suggestion.status !== "dismissed") {
    throw new AppError(
      `Suggestion ${id} is ${suggestion.status}, not kept separate`,
      409,
      { code: "CONFLICT", details: { currentStatus: suggestion.status } },
    );
  }
  const live = (contactId: string) =>
    !!_stmts.isLive.get(contactId, scope.ownerId);
  if (!live(suggestion.contactIdA) || !live(suggestion.contactIdB)) {
    throw new AppError(
      "One of these contacts was merged, archived or deleted since",
      409,
      { code: "CONFLICT" },
    );
  }

  sqlite.transaction(() => {
    _stmts.restoreSuggestion.run(id, scope.ownerId);
    _stmts.deleteExclusion.run(
      scope.ownerId,
      suggestion.contactIdA,
      suggestion.contactIdB,
    );
  })();

  log.info(
    "DedupeSuggestions",
    `[${rid}] Restored suggestion ${id} (${suggestion.contactIdA} ↔ ${suggestion.contactIdB})`,
  );
}

// Maintenance

/**
 * Remove pending suggestions where a contact is gone, merged or archived.
 *
 * @returns Number of suggestions removed
 */
export function clearStaleSuggestions(scope: Scope): number {
  const result = _stmts.clearStale.run(
    scope.ownerId,
    scope.ownerId,
    scope.ownerId,
  );
  if (result.changes > 0) {
    log.info(
      "DedupeSuggestions",
      `Cleared ${result.changes} stale pending suggestions`,
    );
  }
  return result.changes;
}

/**
 * Clear the pending pairs a scan finds again (not a note's) before it stores
 * its results.
 *
 * @returns Number of suggestions cleared
 */
export function clearAllPendingSuggestions(scope: Scope): number {
  const result = _stmts.clearAllPending.run(scope.ownerId);
  return result.changes;
}
