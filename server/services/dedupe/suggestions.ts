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
import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { AppError } from "../../utils/AppError.ts";

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
  contactA?: any;
  contactB?: any;
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
  insertSuggestion: sqlite.prepare(`
    INSERT OR IGNORE INTO dedupe_suggestions
      (id, contactIdA, contactIdB, matchType, confidence, reasoning, matchedField, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getPending: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions
    WHERE status = 'pending'
    ORDER BY confidence DESC
    LIMIT ?
  `),

  getPendingCount: sqlite.prepare(`
    SELECT COUNT(*) AS cnt FROM dedupe_suggestions WHERE status = 'pending'
  `),

  getById: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions WHERE id = ?
  `),

  getForContact: sqlite.prepare(`
    SELECT * FROM dedupe_suggestions
    WHERE (contactIdA = ? OR contactIdB = ?) AND status = 'pending'
    ORDER BY confidence DESC
    LIMIT 1
  `),

  updateStatus: sqlite.prepare(`
    UPDATE dedupe_suggestions
    SET status = ?, reviewedAt = CURRENT_TIMESTAMP, reviewedBy = ?
    WHERE id = ?
  `),

  clearStale: sqlite.prepare(`
    DELETE FROM dedupe_suggestions
    WHERE status = 'pending'
      AND (contactIdA NOT IN (SELECT id FROM contacts WHERE isGhost = 0 AND canonicalId IS NULL)
        OR contactIdB NOT IN (SELECT id FROM contacts WHERE isGhost = 0 AND canonicalId IS NULL))
  `),

  clearAllPending: sqlite.prepare(`
    DELETE FROM dedupe_suggestions WHERE status = 'pending'
  `),

  // --- Exclusions ---
  insertExclusion: sqlite.prepare(`
    INSERT OR IGNORE INTO dedupe_exclusions (contactIdA, contactIdB)
    VALUES (?, ?)
  `),

  // --- Merge Log ---
  insertMergeLog: sqlite.prepare(`
    INSERT INTO dedupe_merge_log
      (id, primaryId, duplicateId, mergedBy, mergeType, confidence, reasoning, duplicateSnapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getMergeLog: sqlite.prepare(`
    SELECT * FROM dedupe_merge_log
    ORDER BY mergedAt DESC
    LIMIT ?
  `),

  getMergeLogById: sqlite.prepare(`
    SELECT * FROM dedupe_merge_log WHERE id = ?
  `),

  undoMergeLog: sqlite.prepare(`
    UPDATE dedupe_merge_log SET undoneAt = CURRENT_TIMESTAMP WHERE id = ?
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
  );
}

/**
 * Store multiple suggestions in a single transaction.
 * Used at the end of a scan to persist all detected pairs.
 */
export function storeSuggestions(
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
export function getPendingSuggestions(limit: number = 100): DedupeSuggestion[] {
  const rows = _stmts.getPending.all(limit) as DedupeSuggestion[];

  // Hydrate contacts for display
  for (const row of rows) {
    try {
      const rawA = sqlite
        .prepare("SELECT * FROM contacts WHERE id = ?")
        .get(row.contactIdA);
      const rawB = sqlite
        .prepare("SELECT * FROM contacts WHERE id = ?")
        .get(row.contactIdB);
      if (rawA) row.contactA = contactRepo.hydrate(rawA);
      if (rawB) row.contactB = contactRepo.hydrate(rawB);
    } catch {
      // Contact may have been deleted — leave hydrated fields as undefined
    }
  }

  return rows;
}

/** Get the count of pending suggestions (for sidebar badge). */
export function getPendingCount(): number {
  return (_stmts.getPendingCount.get() as any).cnt;
}

/** Get a suggestion by ID. */
export function getSuggestionById(id: string): DedupeSuggestion | null {
  const row = _stmts.getById.get(id) as DedupeSuggestion | undefined;
  if (!row) return null;

  // Hydrate contacts
  try {
    const rawA = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(row.contactIdA);
    const rawB = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(row.contactIdB);
    if (rawA) row.contactA = contactRepo.hydrate(rawA);
    if (rawB) row.contactB = contactRepo.hydrate(rawB);
  } catch {
    // Contact may have been deleted
  }

  return row;
}

/**
 * Find a pending suggestion involving a specific contact.
 * Used for point-of-action banners on the contact detail page.
 */
export function getSuggestionForContact(
  contactId: string,
): DedupeSuggestion | null {
  const row = _stmts.getForContact.get(contactId, contactId) as
    | DedupeSuggestion
    | undefined;
  if (!row) return null;

  try {
    const rawA = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(row.contactIdA);
    const rawB = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(row.contactIdB);
    if (rawA) row.contactA = contactRepo.hydrate(rawA);
    if (rawB) row.contactB = contactRepo.hydrate(rawB);
  } catch {
    // Contact may have been deleted
  }

  return row;
}

// =============================================================================
// Suggestion Actions
// =============================================================================

/**
 * Dismiss a suggestion — marks it as 'dismissed' and adds the pair to
 * the exclusions table so it's never re-suggested on future scans.
 */
export function dismissSuggestion(id: string, rid: string): void {
  const suggestion = _stmts.getById.get(id) as DedupeSuggestion | undefined;
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
    _stmts.updateStatus.run("dismissed", "user", id);

    // 2. Add to exclusions (canonical ordering already enforced by storage)
    _stmts.insertExclusion.run(suggestion.contactIdA, suggestion.contactIdB);
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
export function markSuggestionMerged(id: string, mergedBy: string): void {
  const status = mergedBy === "auto" ? "auto_merged" : "merged";
  _stmts.updateStatus.run(status, mergedBy, id);
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
  primaryId: string,
  duplicateId: string,
  confidence: number,
  reasoning: string,
  mergedBy: string,
  mergeType: "soft" | "hard",
  snapshot?: string | null,
): string {
  const id = crypto.randomUUID();
  _stmts.insertMergeLog.run(
    id,
    primaryId,
    duplicateId,
    mergedBy,
    mergeType,
    confidence,
    reasoning,
    snapshot ?? null,
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
export function getMergeLog(limit: number = 50): MergeLogEntry[] {
  const rows = _stmts.getMergeLog.all(limit) as MergeLogEntry[];

  // Hydrate contact names for display
  for (const row of rows) {
    try {
      // Primary may still exist; duplicate may be soft-merged (canonicalId set) or hard-deleted
      const primary = sqlite
        .prepare("SELECT name FROM contacts WHERE id = ?")
        .get(row.primaryId) as any;
      const duplicate = sqlite
        .prepare("SELECT name FROM contacts WHERE id = ?")
        .get(row.duplicateId) as any;
      row.primaryName = primary?.name ?? "(deleted)";
      row.duplicateName = duplicate?.name ?? "(deleted)";
    } catch {
      row.primaryName = "(unknown)";
      row.duplicateName = "(unknown)";
    }
  }

  return rows;
}

/**
 * Undo a soft merge — restores the duplicate contact's visibility.
 *
 * What this does:
 * 1. Sets `canonicalId = NULL` on the duplicate contact
 * 2. Marks the merge log entry as undone
 *
 * What this does NOT do:
 * - Does NOT reverse child record transfers (emails, phones, etc. stay on primary)
 *   This is by design: additive merges are safe to keep, and reversing them
 *   risks data loss if the primary was edited after merge.
 *
 * @throws Error if the merge log entry is not found, already undone, or was a hard merge
 */
export function undoSoftMerge(mergeLogId: string, rid: string): void {
  const entry = _stmts.getMergeLogById.get(mergeLogId) as
    | MergeLogEntry
    | undefined;

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
  if (entry.mergeType !== "soft") {
    throw new AppError(
      `Cannot undo a hard merge — the duplicate was permanently deleted`,
      409,
      {
        code: "HARD_MERGE_IRREVERSIBLE",
        details: { mergeLogId },
      },
    );
  }

  // Verify the duplicate contact still exists (it should — soft merge doesn't delete)
  const duplicate = sqlite
    .prepare("SELECT id, canonicalId FROM contacts WHERE id = ?")
    .get(entry.duplicateId) as any;

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

  const txn = sqlite.transaction(() => {
    // 1. Restore the duplicate contact's visibility
    sqlite
      .prepare("UPDATE contacts SET canonicalId = NULL WHERE id = ?")
      .run(entry.duplicateId);

    // 2. Mark the merge log entry as undone
    _stmts.undoMergeLog.run(mergeLogId);

    // 3. Remove the corresponding suggestion's "auto_merged" status
    //    so it can re-appear as "pending" if the user wants to re-evaluate
    sqlite
      .prepare(
        `
      UPDATE dedupe_suggestions
      SET status = 'pending', reviewedAt = NULL, reviewedBy = NULL
      WHERE ((contactIdA = ? AND contactIdB = ?) OR (contactIdA = ? AND contactIdB = ?))
        AND status = 'auto_merged'
    `,
      )
      .run(
        entry.primaryId,
        entry.duplicateId,
        entry.duplicateId,
        entry.primaryId,
      );
  });
  txn();

  log.info(
    "DedupeSuggestions",
    `[${rid}] Undone soft merge ${mergeLogId}: restored ${entry.duplicateId} (was merged into ${entry.primaryId})`,
  );
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
export function clearStaleSuggestions(): number {
  const result = _stmts.clearStale.run();
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
export function clearAllPendingSuggestions(): number {
  const result = _stmts.clearAllPending.run();
  return result.changes;
}
