// =============================================================================
// Dedupe Suggestions Service — Persistent Suggestion + Merge Log Management
// =============================================================================
// Manages the lifecycle of dedupe suggestions: creation from scan results,
// user review (merge/dismiss), auto-merge with soft-delete, and undo.
//
// Tables used:
//   dedupe_suggestions — detected pairs with status lifecycle
//   dedupe_exclusions  — never-merge pairs (populated on dismiss)
//   dedupe_merge_log   — audit trail for all merges (soft + hard)
//
// Design principles:
// - All writes are transactional (single-statement or explicit transaction)
// - Pre-compiled prepared statements for query performance
// - Canonical pair ordering (contactIdA < contactIdB) enforced on store
// - Idempotent inserts (INSERT OR IGNORE for re-scans)
// - Suggestion status lifecycle: pending → merged | dismissed | auto_merged
// =============================================================================

import crypto from "crypto";
import { sqlite, db } from "../../db.ts";
import * as schema from "../../../src/db/schema.ts";
import { and, eq } from "drizzle-orm";
import type { Scope } from "../../tenancy/scope.ts";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { AppError } from "../../utils/AppError.ts";
import { scheduleSearchIndex } from "../search/indexQueue.ts";
import type {
  ContactRow,
  HydratedContact,
  MergeConflict,
  MergeSnapshotData,
  UndoMergeResult,
} from "./types.ts";
import { UnionFind } from "../../utils/unionFind.ts";

// =============================================================================
// Types
// =============================================================================

export interface DedupeSuggestion {
  id: string;
  contactIdA: string;
  contactIdB: string;
  matchType: string;
  confidence: number;
  reasoning: string;
  matchedField: string | null;
  status: "pending" | "auto_merged" | "merged" | "dismissed";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  // Hydrated contact data (populated by getPendingSuggestions)
  contactA?: HydratedContact | null;
  contactB?: HydratedContact | null;
}

export interface MergeLogEntry {
  id: string;
  primaryId: string;
  duplicateId: string;
  mergedBy: string; // 'user' | 'auto' | 'user:suggestion'
  mergeType: string; // 'soft' | 'hard'
  confidence: number;
  reasoning: string;
  mergedAt: string;
  undoneAt: string | null;
  duplicateSnapshot: string | null;
  // Hydrated fields (populated by getMergeLog)
  primaryName?: string;
  duplicateName?: string;
}

// =============================================================================
// Prepared Statements
// =============================================================================

const _stmts = {
  // --- Suggestions ---
  // A suggestion, an exclusion and a merge log row all name their owner on
  // insert. The fill trigger would derive it from `contactIdA`, but the pair
  // check that makes it right lives in the service, so the service writes it explicitly.
  insertSuggestion: sqlite.prepare(`
    INSERT OR IGNORE INTO dedupe_suggestions
      (id, contactIdA, contactIdB, matchType, confidence, reasoning, matchedField, status, ownerId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getPending: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending'
    ORDER BY confidence DESC
    LIMIT ?
  `),

  getPendingCount: sqlite.prepare(`
    SELECT COUNT(*) AS cnt FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending'
  `),

  getPendingPairs: sqlite.prepare(`
    SELECT contactIdA, contactIdB FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending'
  `),

  getById: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions WHERE id = ? AND ownerId = ?
  `),

  getForContact: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions
    WHERE ownerId = ? AND (contactIdA = ? OR contactIdB = ?) AND status = 'pending'
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
    WHERE ownerId = ? AND status = 'pending'
      AND (contactIdA NOT IN (SELECT id FROM contacts WHERE ownerId = ? AND isGhost = 0 AND canonicalId IS NULL)
        OR contactIdB NOT IN (SELECT id FROM contacts WHERE ownerId = ? AND isGhost = 0 AND canonicalId IS NULL))
  `),

  clearAllPending: sqlite.prepare(`
    DELETE FROM dedupe_suggestions WHERE ownerId = ? AND status = 'pending'
  `),

  // --- Exclusions ---
  insertExclusion: sqlite.prepare(`
    INSERT OR IGNORE INTO dedupe_exclusions (contactIdA, contactIdB, ownerId)
    VALUES (?, ?, ?)
  `),

  // --- Merge Log ---
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

  /** One contact's display name, for the merge log. */
  contactName: sqlite.prepare(`
    SELECT name FROM contacts WHERE id = ? AND ownerId = ?
  `),

  reopenSuggestion: sqlite.prepare(`
    UPDATE dedupe_suggestions
    SET status = 'pending', reviewedAt = NULL, reviewedBy = NULL
    WHERE ownerId = ?
      AND ((contactIdA = ? AND contactIdB = ?) OR (contactIdA = ? AND contactIdB = ?))
      AND status IN ('auto_merged', 'user_merged', 'merged')
  `),
};

// =============================================================================
// Suggestion CRUD
// =============================================================================

/**
 * Store a single suggestion. Uses canonical pair ordering (A < B).
 * INSERT OR IGNORE makes this idempotent — safe for re-scans.
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
  );
}

/**
 * Store multiple suggestions in a single transaction.
 * Used at the end of a scan to persist all detected pairs.
 */
export function storeSuggestions(
  scope: Scope,
  pairs: {
    idA: string;
    idB: string;
    matchType: string;
    confidence: number;
    reasoning: string;
    matchedField?: string;
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
      );
    }
  });
  txn();
}

/**
 * Get all pending suggestions, ordered by confidence descending.
 * Hydrates both contacts for display purposes.
 *
 * @param limit - Max suggestions to return (default 100)
 */
export function getPendingSuggestions(
  scope: Scope,
  limit: number = 100,
): DedupeSuggestion[] {
  const rows = _stmts.getPending.all(
    scope.ownerId,
    limit,
  ) as DedupeSuggestion[];
  if (!rows.length) return rows;

  // Bulk-hydrate every referenced contact in one IN(...) query — per-row
  // hydrate() here previously cost ~26 queries per suggestion.
  try {
    const ids = [...new Set(rows.flatMap((r) => [r.contactIdA, r.contactIdB]))];
    const hydrated = new Map(
      contactRepo
        .hydrateMany(contactRepo.findManyOwned(scope, ids))
        .map((c) => [c.id, c]),
    );
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

/** Get the count of pending suggestions (for sidebar badge). */
export function getPendingCount(scope: Scope): number {
  return (_stmts.getPendingCount.get(scope.ownerId) as { cnt: number }).cnt;
}

/**
 * The number of review cards the Duplicates page will show.
 *
 * `getPendingCount` counts pending PAIRS. The review queue groups those pairs
 * into clusters with union-find, because pairs (A,B) and (B,C) describe one
 * problem with three contacts, not two problems. The sidebar badge read the
 * pair count, so it promised 7 items and the page then showed 3.
 *
 * This counts clusters, so the badge and the page agree. The work is a scan of
 * the pending table plus one union per row, which is near constant time each;
 * the pending set is tens of rows, not thousands.
 *
 * @returns the count of connected groups among pending suggestions
 */
export function getPendingClusterCount(scope: Scope): number {
  const pairs = _stmts.getPendingPairs.all(scope.ownerId) as {
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
 * Attach both contacts to a suggestion row.
 *
 * The two ids come off a row this account owns, and the pair check that wrote
 * the row proved both contacts share that owner, so a scoped read here always
 * finds them unless one has since been merged away.
 */
function hydratePair(scope: Scope, row: DedupeSuggestion): void {
  try {
    const rawA = contactRepo.findOwned(scope, row.contactIdA);
    const rawB = contactRepo.findOwned(scope, row.contactIdB);
    if (rawA) row.contactA = contactRepo.hydrate(rawA);
    if (rawB) row.contactB = contactRepo.hydrate(rawB);
  } catch {
    // Contact may have been deleted
  }
}

/**
 * Find a pending suggestion involving a specific contact.
 * Used for point-of-action banners on the contact detail page.
 */
export function getSuggestionForContact(
  scope: Scope,
  contactId: string,
): DedupeSuggestion | null {
  const row = _stmts.getForContact.get(scope.ownerId, contactId, contactId) as
    DedupeSuggestion | undefined;
  if (!row) return null;
  hydratePair(scope, row);
  return row;
}

// =============================================================================
// Suggestion Actions
// =============================================================================

/**
 * Dismiss a suggestion — marks it as 'dismissed' and adds the pair to
 * the exclusions table so it's never re-suggested on future scans.
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
 * Mark a suggestion as merged (after the merge was performed externally).
 *
 * @param mergedBy - Who performed the merge: 'user', 'auto', or 'user:suggestion'
 */
export function markSuggestionMerged(
  scope: Scope,
  id: string,
  mergedBy: string,
): void {
  const status = mergedBy === "auto" ? "auto_merged" : "merged";
  _stmts.updateStatus.run(status, mergedBy, id, scope.ownerId);
}

// =============================================================================
// Merge Log — Audit Trail
// =============================================================================

/**
 * Insert a merge audit-log row. Stand-alone variant: opens its own
 * `sqlite.transaction` so the row is committed atomically.
 *
 * Use `recordMergeUnsafe` (below) when the caller is ALREADY inside a
 * transaction — better-sqlite3 disallows nested transactions, and a nested
 * call here would throw "cannot start a transaction within a transaction".
 *
 * @param primaryId    - The surviving contact
 * @param duplicateId  - The contact being merged away
 * @param confidence   - The match confidence that triggered the merge
 * @param reasoning    - Human-readable explanation
 * @param mergedBy     - Who: 'user', 'auto', 'user:suggestion'
 * @param mergeType    - How: 'soft' (canonicalId) or 'hard' (DELETE)
 * @param snapshot     - Optional JSON snapshot of the duplicate before merge
 * @returns The merge log entry ID
 */
export function recordMerge(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
  confidence: number,
  reasoning: string,
  mergedBy: string,
  mergeType: "soft" | "hard",
  snapshot?: string | null,
): string {
  let id: string;
  const txn = sqlite.transaction(() => {
    id = recordMergeUnsafe(
      scope,
      primaryId,
      duplicateId,
      confidence,
      reasoning,
      mergedBy,
      mergeType,
      snapshot,
    );
  });
  txn();
  return id!;
}

/**
 * INTERNAL — caller MUST already hold a transaction. Used by
 * `mergeContacts` and `softMergeContacts` so the audit log entry is
 * folded into the SAME transaction as the merge mutations.
 *
 * Why this matters: prior to this split the audit log was written AFTER
 * the merge txn committed. A crash (or any thrown exception in the audit
 * insert) between commit and recordMerge would orphan the merge — the
 * contacts were merged, but `dedupe_merge_log` had no row, so `undoSoftMerge`
 * was permanently impossible.
 */
export function recordMergeUnsafe(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
  confidence: number,
  reasoning: string,
  mergedBy: string,
  mergeType: "soft" | "hard",
  snapshot?: string | null,
): string {
  const id = crypto.randomUUID();
  // The owner is the caller's, not a lookup on the surviving contact. Both
  // merged contacts belong to this account: `mergeContacts` proved that in one
  // statement before it touched a single child row.
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
 * Get the merge audit log, most recent first.
 *
 * @param limit - Max entries to return (default 50)
 */
export function getMergeLog(scope: Scope, limit: number = 50): MergeLogEntry[] {
  const rows = _stmts.getMergeLog.all(scope.ownerId, limit) as MergeLogEntry[];

  // Hydrate contact names for display
  for (const row of rows) {
    try {
      // Primary may still exist; duplicate may be soft-merged (canonicalId set) or hard-deleted
      const primary = _stmts.contactName.get(row.primaryId, scope.ownerId) as
        { name: string } | undefined;
      const duplicate = _stmts.contactName.get(
        row.duplicateId,
        scope.ownerId,
      ) as { name: string } | undefined;
      row.primaryName = primary?.name ?? "(deleted)";
      row.duplicateName = duplicate?.name ?? "(deleted)";
    } catch {
      row.primaryName = "(unknown)";
      row.duplicateName = "(unknown)";
    }
  }

  return rows;
}

function restoreChildRow(
  table: string,
  row: Record<string, unknown>,
  targetContactId: string,
  scope: Scope,
  newId?: string,
) {
  const insertId = newId ?? (row.id as string);
  switch (table) {
    case "contact_emails":
      sqlite
        .prepare(
          "INSERT INTO contact_emails (id, contactId, email, label, isPrimary, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.email ?? "",
          row.label ?? null,
          row.isPrimary ?? 0,
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_phones":
      sqlite
        .prepare(
          "INSERT INTO contact_phones (id, contactId, phone, label, isPrimary, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.phone ?? "",
          row.label ?? null,
          row.isPrimary ?? 0,
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_addresses":
      sqlite
        .prepare(
          "INSERT INTO contact_addresses (id, contactId, address, label, isPrimary, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.address ?? "",
          row.label ?? null,
          row.isPrimary ?? 0,
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_social_links":
      sqlite
        .prepare(
          "INSERT INTO contact_social_links (id, contactId, platform, url, createdAt) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.platform ?? "",
          row.url ?? "",
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_education":
      sqlite
        .prepare(
          "INSERT INTO contact_education (id, contactId, school, degree, fieldOfStudy, startYear, endYear, isCurrent, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.school ?? "",
          row.degree ?? null,
          row.fieldOfStudy ?? null,
          row.startYear ?? null,
          row.endYear ?? null,
          row.isCurrent ?? 0,
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_experience":
      sqlite
        .prepare(
          "INSERT INTO contact_experience (id, contactId, company, role, location, description, startYear, endYear, isCurrent, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.company ?? "",
          row.role ?? null,
          row.location ?? null,
          row.description ?? null,
          row.startYear ?? null,
          row.endYear ?? null,
          row.isCurrent ?? 0,
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_sources":
      sqlite
        .prepare(
          "INSERT INTO contact_sources (id, contactId, platform, externalId, createdAt) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.platform ?? "",
          row.externalId ?? "",
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_tags":
      sqlite
        .prepare(
          "INSERT INTO contact_tags (id, contactId, tag, createdAt) VALUES (?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.tag ?? "",
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_interests":
      sqlite
        .prepare(
          "INSERT INTO contact_interests (id, contactId, interest, createdAt) VALUES (?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.interest ?? "",
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "contact_attributes":
      sqlite
        .prepare(
          "INSERT INTO contact_attributes (id, contactId, name, value, createdAt) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.name ?? "",
          row.value ?? "",
          row.createdAt ?? new Date().toISOString(),
        );
      break;
    case "interactions":
      sqlite
        .prepare(
          "INSERT INTO interactions (id, contactId, type, title, summary, date, location, channel, sentiment, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.type ?? "meeting",
          row.title ?? null,
          row.summary ?? "",
          row.date ?? new Date().toISOString(),
          row.location ?? null,
          row.channel ?? null,
          row.sentiment ?? null,
          scope.ownerId,
          row.createdAt ?? new Date().toISOString(),
          row.updatedAt ?? new Date().toISOString(),
        );
      break;
    case "action_items":
      sqlite
        .prepare(
          "INSERT INTO action_items (id, contactId, interactionId, title, dueAt, completedAt, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          insertId,
          targetContactId,
          row.interactionId ?? null,
          row.title ?? "",
          row.dueAt ?? new Date().toISOString(),
          row.completedAt ?? null,
          scope.ownerId,
          row.createdAt ?? new Date().toISOString(),
          row.updatedAt ?? new Date().toISOString(),
        );
      break;
  }
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
      "startYear",
      "endYear",
      "isCurrent",
    ],
    contact_experience: [
      "company",
      "role",
      "location",
      "description",
      "startYear",
      "endYear",
      "isCurrent",
    ],
    contact_sources: ["platform", "externalId"],
    contact_tags: ["tag"],
    contact_interests: ["interest"],
    contact_attributes: ["name", "value"],
    interactions: [
      "type",
      "title",
      "summary",
      "date",
      "location",
      "channel",
      "sentiment",
    ],
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
 * Undo a merge — restores the duplicate contact's visibility, reverses
 * unchanged record transfers, preserves post-merge edits on survivor,
 * recomputes task follow-ups, and reports any conflicts encountered.
 *
 * @throws Error if the merge log entry is not found, already undone, or was a permanently deleted legacy hard merge
 */
export function undoSoftMerge(
  scope: Scope,
  mergeLogId: string,
  rid: string,
): UndoMergeResult {
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
    if (entry.mergeType === "hard" && !entry.duplicateSnapshot) {
      throw new AppError(
        `Cannot undo a hard merge — the duplicate was permanently deleted`,
        409,
        {
          code: "HARD_MERGE_IRREVERSIBLE",
          details: { mergeLogId },
        },
      );
    }
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

  const txn = sqlite.transaction(() => {
    if (entry.duplicateSnapshot) {
      try {
        const snapshot = JSON.parse(
          entry.duplicateSnapshot,
        ) as MergeSnapshotData;

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
              scalarReverts.addedAt =
                snapshot.changes.addedAtUpdated.oldAddedAt;
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
      } catch (err) {
        log.warn(
          "DedupeSuggestions",
          `[${rid}] Error restoring from snapshot, falling back to basic undo: ${err}`,
        );
      }
    }

    // 6. Restore the duplicate contact's visibility
    _stmts.restoreDuplicate.run(entry.duplicateId, scope.ownerId);

    // 7. Mark the merge log entry as undone
    _stmts.undoMergeLog.run(mergeLogId, scope.ownerId);

    // 8. Reopen corresponding suggestion
    _stmts.reopenSuggestion.run(
      scope.ownerId,
      entry.primaryId,
      entry.duplicateId,
      entry.duplicateId,
      entry.primaryId,
    );
  });

  txn();

  scheduleSearchIndex(entry.primaryId);
  scheduleSearchIndex(entry.duplicateId);

  log.info(
    "DedupeSuggestions",
    `[${rid}] Undone merge ${mergeLogId}: restored ${entry.duplicateId} (was merged into ${entry.primaryId}) with ${conflicts.length} conflict(s)`,
  );

  return {
    restoredContactId: entry.duplicateId,
    conflicts,
  };
}

// =============================================================================
// Maintenance
// =============================================================================

/**
 * Remove stale pending suggestions where one or both contacts
 * no longer exist or have been merged/archived.
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
 * Clear all pending suggestions (used before persisting new scan results
 * to avoid double-counting from previous scans).
 *
 * @returns Number of suggestions cleared
 */
export function clearAllPendingSuggestions(scope: Scope): number {
  const result = _stmts.clearAllPending.run(scope.ownerId);
  return result.changes;
}
