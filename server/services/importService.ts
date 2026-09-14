// =============================================================================
// Import Service — one durable record per bulk import
// =============================================================================
// A bulk import used to exist only for the life of its request. The browser
// parsed a file, posted the rows, and read a stream of progress frames until
// a `done` frame arrived. Two things went wrong with that.
//
// The stream could end without a `done` frame, when a phone changed networks
// or a proxy timed out an idle connection, and the browser showed "Import
// Complete" anyway. It had no way to ask what had happened.
//
// And a second attempt was a second import. Every request made fresh contact
// ids, so a person who saw an error and tried again had every contact twice,
// with a duplicate scan to clean up after.
//
// This module gives every import an id the browser chooses, a row that
// records what happened to it, and a row per contact that says whether that
// contact was written. A second request with a known id answers with the
// record rather than importing again. A read of a record whose process died
// settles it: an import that never committed is reported failed, and one that
// committed but never finished its duplicate check is finished now.
//
// The row per contact is also what makes a retry possible. A row that fails
// keeps its payload, and `retry` runs those rows again without the browser
// re-sending the file. A row that succeeds keeps only its contact id.
//
// @module server/services/importService
// =============================================================================

import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { AppError, NotFoundError } from "../utils/AppError.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import type { Scope } from "../tenancy/scope.ts";
import type { NewContactPayload } from "../repositories/types.ts";
import {
  generateAndStoreBulkEmbeddings,
  isEmbeddingAvailable,
} from "./dedupe/embeddings.ts";
import { dedupeService } from "./dedupe/index.ts";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * Where an import is.
 *
 * `running`  the contacts are being written and nothing is committed.
 * `imported` the contacts are committed. The duplicate check is still to run,
 *            is running, or is being resumed.
 * `complete` everything finished and the summary is set.
 * `failed`   nothing was imported. The same request can be sent again.
 */
export type ImportStatus = "running" | "imported" | "complete" | "failed";

export type ImportPhase = "importing" | "embedding" | "scanning" | "done";

export interface ImportSummary {
  imported: number;
  autoMerged: number;
  needsReview: number;
  newUnique: number;
  failed: number;
}

export interface ImportRecord {
  id: string;
  status: ImportStatus;
  phase: ImportPhase | null;
  message: string | null;
  total: number;
  processed: number;
  imported: number;
  failed: number;
  summary: ImportSummary | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ImportRow {
  index: number;
  status: "done" | "failed";
  name: string | null;
  error: string | null;
  contactId: string | null;
}

/** The raw row, as the table holds it. */
interface ImportTableRow {
  id: string;
  ownerId: string;
  status: ImportStatus;
  phase: ImportPhase | null;
  message: string | null;
  total: number;
  processed: number;
  imported: number;
  failed: number;
  autoMerged: number | null;
  needsReview: number | null;
  newUnique: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** A progress frame, the shape the SSE route writes. */
export type ImportFrame = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The process's own imports
// ---------------------------------------------------------------------------

/**
 * Imports this process is running right now.
 *
 * A `running` row whose id is not here belongs to a process that died. The
 * row says the contacts were being written, the absence here says nobody is
 * writing them, and together they say the write never committed.
 */
const live = new Map<string, { ownerId: string }>();

const INTERRUPTED_BEFORE_COMMIT =
  "The import was interrupted before any contact was saved.";

/** A second request for an import this process is still running. */
function inProgress(id: string): AppError {
  return new AppError("This import is already running.", 409, {
    code: "IMPORT_IN_PROGRESS",
    details: { importId: id },
  });
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------
// Every statement on `imports` names the owner. `import_rows` reaches its
// owner through the import it belongs to, and every write to it is gated on
// that row existing for this owner.

const _stmts = {
  get: sqlite.prepare(`SELECT * FROM imports WHERE id = ? AND ownerId = ?`),

  insert: sqlite.prepare(`
    INSERT INTO imports (id, ownerId, status, phase, message, total)
    VALUES (?, ?, 'running', 'importing', ?, ?)
  `),

  /** Start over under the same id, after a failure that committed nothing. */
  restart: sqlite.prepare(`
    UPDATE imports
       SET status = 'running', phase = 'importing', message = ?, total = ?,
           processed = 0, imported = 0, failed = 0,
           autoMerged = NULL, needsReview = NULL, newUnique = NULL,
           error = NULL, completedAt = NULL, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND ownerId = ?
  `),

  /** Who owns an id, if anyone. For the collision check only. */
  ownerOf: sqlite.prepare(
    // tenant-lint: allow owner-checked by caller
    `SELECT ownerId FROM imports WHERE id = ?`,
  ),

  rowDone: sqlite.prepare(`
    INSERT INTO import_rows (importId, rowIndex, status, contactId, name, error, payload)
    SELECT ?, ?, 'done', ?, ?, NULL, NULL
     WHERE EXISTS (SELECT 1 FROM imports WHERE id = ? AND ownerId = ?)
    ON CONFLICT(importId, rowIndex) DO UPDATE SET
      status = 'done', contactId = excluded.contactId, name = excluded.name,
      error = NULL, payload = NULL
  `),

  rowFailed: sqlite.prepare(`
    INSERT INTO import_rows (importId, rowIndex, status, contactId, name, error, payload)
    SELECT ?, ?, 'failed', NULL, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM imports WHERE id = ? AND ownerId = ?)
    ON CONFLICT(importId, rowIndex) DO UPDATE SET
      status = 'failed', contactId = NULL, name = excluded.name,
      error = excluded.error, payload = excluded.payload
  `),

  progress: sqlite.prepare(`
    UPDATE imports SET processed = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND ownerId = ?
  `),

  /**
   * The contacts are committed. Counts come from the rows rather than from
   * the caller, so a retry that turns three failed rows into three done ones
   * lands on the same numbers a fresh import would.
   */
  markImported: sqlite.prepare(`
    UPDATE imports
       SET status = 'imported', phase = 'embedding', message = NULL,
           processed = total,
           imported = (SELECT COUNT(*) FROM import_rows WHERE importId = imports.id AND status = 'done'),
           failed = (SELECT COUNT(*) FROM import_rows WHERE importId = imports.id AND status = 'failed'),
           updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND ownerId = ?
  `),

  phase: sqlite.prepare(`
    UPDATE imports SET phase = ?, message = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND ownerId = ?
  `),

  complete: sqlite.prepare(`
    UPDATE imports
       SET status = 'complete', phase = 'done', message = NULL,
           autoMerged = ?, needsReview = ?, newUnique = ?, error = ?,
           completedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND ownerId = ?
  `),

  /** Only a run that never committed can fail. An `imported` row stays. */
  fail: sqlite.prepare(`
    UPDATE imports
       SET status = 'failed', phase = NULL, message = NULL, error = ?,
           updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND ownerId = ? AND status = 'running'
  `),

  rows: sqlite.prepare(`
    SELECT r.rowIndex, r.status, r.name, r.error, r.contactId
      FROM import_rows r
      JOIN imports i ON i.id = r.importId
     WHERE i.id = ? AND i.ownerId = ? AND r.status = ?
     ORDER BY r.rowIndex
     LIMIT ?
  `),

  failedPayloads: sqlite.prepare(`
    SELECT r.rowIndex, r.payload
      FROM import_rows r
      JOIN imports i ON i.id = r.importId
     WHERE i.id = ? AND i.ownerId = ? AND r.status = 'failed'
     ORDER BY r.rowIndex
  `),

  createdIds: sqlite.prepare(`
    SELECT r.contactId
      FROM import_rows r
      JOIN imports i ON i.id = r.importId
     WHERE i.id = ? AND i.ownerId = ? AND r.status = 'done' AND r.contactId IS NOT NULL
     ORDER BY r.rowIndex
  `),

  /**
   * What the duplicate check found for this import's contacts.
   *
   * Read from the suggestions table rather than carried back from the scan,
   * so a resumed check and a retried one add up the same way a fresh one
   * does. A pair is counted once whichever side of it the import wrote.
   */
  matches: sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM dedupe_suggestions s
        WHERE s.ownerId = ? AND s.status = 'auto_merged'
          AND EXISTS (SELECT 1 FROM import_rows r
                       WHERE r.importId = ? AND r.status = 'done'
                         AND r.contactId IN (s.contactIdA, s.contactIdB))) AS autoMerged,
      (SELECT COUNT(*) FROM dedupe_suggestions s
        WHERE s.ownerId = ? AND s.status = 'pending'
          AND EXISTS (SELECT 1 FROM import_rows r
                       WHERE r.importId = ? AND r.status = 'done'
                         AND r.contactId IN (s.contactIdA, s.contactIdB))) AS needsReview,
      (SELECT COUNT(*) FROM import_rows r
        WHERE r.importId = ? AND r.status = 'done'
          AND EXISTS (SELECT 1 FROM dedupe_suggestions s
                       WHERE s.ownerId = ?
                         AND r.contactId IN (s.contactIdA, s.contactIdB))) AS matched
  `),

  /**
   * Pending suggestions naming this import's contacts, for a resumed check.
   *
   * A check that died part way may have written some of them already, and
   * the scan that runs again would write them twice. Auto-merged rows stay:
   * the merge they record happened.
   */
  clearPending: sqlite.prepare(`
    DELETE FROM dedupe_suggestions
     WHERE ownerId = ? AND status = 'pending'
       AND EXISTS (SELECT 1 FROM import_rows r
                    WHERE r.importId = ? AND r.status = 'done'
                      AND r.contactId IN (dedupe_suggestions.contactIdA, dedupe_suggestions.contactIdB))
  `),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRecord(row: ImportTableRow): ImportRecord {
  const summary: ImportSummary | null =
    row.status === "complete"
      ? {
          imported: row.imported,
          autoMerged: row.autoMerged ?? 0,
          needsReview: row.needsReview ?? 0,
          newUnique: row.newUnique ?? 0,
          failed: row.failed,
        }
      : null;
  return {
    id: row.id,
    status: row.status,
    phase: row.phase,
    message: row.message,
    total: row.total,
    processed: row.processed,
    imported: row.imported,
    failed: row.failed,
    summary,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function read(scope: Scope, id: string): ImportTableRow | undefined {
  return _stmts.get.get(id, scope.ownerId) as ImportTableRow | undefined;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export const importService = {
  /** True while this process is running the import. */
  isLive(id: string): boolean {
    return live.has(id);
  },

  /**
   * Record the start of an import, or recognise one already recorded.
   *
   * Returns `repeated: true` when the id names an import this account has
   * already run to a commit, and nothing more should happen. Throws 409 when
   * the import is running in this process, because a second copy would race
   * the first. A `running` row nobody is running, or a `failed` one, is a
   * run that never committed and starts again under the same id.
   */
  begin(
    scope: Scope,
    id: string,
    total: number,
    message: string,
  ): { record: ImportRecord; repeated: boolean } {
    const existing = read(scope, id);
    if (existing) {
      if (existing.status === "running" && live.has(id)) {
        throw inProgress(id);
      }
      if (existing.status === "imported" || existing.status === "complete") {
        return { record: toRecord(existing), repeated: true };
      }
      // `failed`, or `running` with nobody running it: nothing was written.
      _stmts.restart.run(message, total, id, scope.ownerId);
      live.set(id, { ownerId: scope.ownerId });
      return { record: toRecord(read(scope, id)!), repeated: false };
    }

    // Another account's id. UUIDs do not collide by accident, and answering
    // with that account's record would be a leak, so the id is refused.
    const holder = _stmts.ownerOf.get(id) as { ownerId: string } | undefined;
    if (holder) {
      throw new AppError("That import id is in use.", 409, {
        code: "IMPORT_ID_IN_USE",
        details: { importId: id },
      });
    }

    _stmts.insert.run(id, scope.ownerId, message, total);
    live.set(id, { ownerId: scope.ownerId });
    return { record: toRecord(read(scope, id)!), repeated: false };
  },

  /** A fresh id, for a caller that sent none. */
  newId(): string {
    return crypto.randomUUID();
  },

  // -- Called from inside the import transaction --------------------------
  //
  // These three run inside `contactService.bulkCreateContacts`'s transaction,
  // so the rows and the status commit with the contacts or not at all. A
  // record can never say `imported` about contacts that are not there.

  rowDone(
    scope: Scope,
    id: string,
    index: number,
    contactId: string,
    name: string,
  ): void {
    _stmts.rowDone.run(id, index, contactId, name, id, scope.ownerId);
  },

  rowFailed(
    scope: Scope,
    id: string,
    index: number,
    name: string,
    error: string,
    payload: NewContactPayload,
  ): void {
    _stmts.rowFailed.run(
      id,
      index,
      name,
      error,
      JSON.stringify(payload),
      id,
      scope.ownerId,
    );
  },

  markImported(scope: Scope, id: string): void {
    _stmts.markImported.run(id, scope.ownerId);
  },

  // -- Outside the transaction --------------------------------------------

  /** How far the write has got, for a browser that is polling. */
  progress(scope: Scope, id: string, processed: number): void {
    _stmts.progress.run(processed, id, scope.ownerId);
  },

  /** The run threw before it committed. */
  fail(scope: Scope, id: string, error: string): void {
    _stmts.fail.run(error, id, scope.ownerId);
    live.delete(id);
  },

  /**
   * The tail of an import: fingerprints, the duplicate check, the summary.
   *
   * The same function for a fresh import, a retry, and a resumed check, and
   * the same for the stream and the JSON path. `send` is the stream's frame
   * writer when there is one. Every phase is written to the record as well,
   * so a browser that lost the stream reads the same progress by polling.
   *
   * Never throws. A check that fails after the contacts are committed leaves
   * them committed, marks the import complete with the counts it could
   * derive, and puts the failure in `error` for the record to show.
   */
  async finish(
    scope: Scope,
    id: string,
    createdIds: string[],
    rid: string,
    send?: (frame: ImportFrame) => void,
    options: { skipEmbedding?: boolean } = {},
  ): Promise<ImportRecord> {
    live.set(id, { ownerId: scope.ownerId });
    let error: string | null = null;
    try {
      // The JSON path starts the fingerprints before it answers, so it
      // passes `skipEmbedding` and this step is not run a second time.
      if (createdIds.length > 0 && !options.skipEmbedding) {
        // The phase is announced only when a provider can answer. The call
        // itself is unconditional: with no provider it returns at once, and
        // the tenancy test that stubs it counts on being reached.
        if (isEmbeddingAvailable()) {
          const message = "Generating contact fingerprints…";
          _stmts.phase.run("embedding", message, id, scope.ownerId);
          send?.({ phase: "embedding", message });
        }
        try {
          await generateAndStoreBulkEmbeddings(createdIds);
          log.info(
            "Imports",
            `[${rid}] Bulk embeddings generated for ${createdIds.length} contacts`,
          );
        } catch (err: unknown) {
          log.warn(
            "Imports",
            `[${rid}] Bulk embedding failed: ${getErrorMessage(err)}`,
          );
        }
      }

      if (createdIds.length > 0) {
        const message = "Looking for duplicates…";
        _stmts.phase.run("scanning", message, id, scope.ownerId);
        send?.({ phase: "scanning", message });
        // A resumed check may be running over pairs a dead one already
        // wrote. Pending rows are cleared and found again; merged ones stand.
        _stmts.clearPending.run(scope.ownerId, id);
        let autoMerged = 0;
        let needsReview = 0;
        await dedupeService.runImportScan(scope, createdIds, rid, {
          onProgress: (checked, total) => {
            if (checked % 50 === 0 && checked < total) {
              const progress = `Checked ${checked}/${total} contacts…`;
              _stmts.phase.run("scanning", progress, id, scope.ownerId);
              const counts = _stmts.matches.get(
                scope.ownerId,
                id,
                scope.ownerId,
                id,
                id,
                scope.ownerId,
              ) as { autoMerged: number; needsReview: number };
              autoMerged = counts.autoMerged;
              needsReview = counts.needsReview;
              send?.({
                phase: "scanning",
                message: progress,
                autoMerged,
                needsReview,
              });
            }
          },
        });
      }
    } catch (err: unknown) {
      error = `The duplicate check did not finish: ${getErrorMessage(err)}`;
      log.warn("Imports", `[${rid}] ${error}`);
    }

    const counts = _stmts.matches.get(
      scope.ownerId,
      id,
      scope.ownerId,
      id,
      id,
      scope.ownerId,
    ) as { autoMerged: number; needsReview: number; matched: number };
    const current = read(scope, id);
    const newUnique = Math.max(0, (current?.imported ?? 0) - counts.matched);
    _stmts.complete.run(
      counts.autoMerged,
      counts.needsReview,
      newUnique,
      error,
      id,
      scope.ownerId,
    );
    live.delete(id);

    const record = toRecord(read(scope, id)!);
    log.info(
      "Imports",
      `[${rid}] Import ${id} complete: ${record.imported} imported, ${record.failed} failed, ${counts.autoMerged} auto-merged, ${counts.needsReview} pending`,
    );
    return record;
  },

  /**
   * The record, settled.
   *
   * A `running` import nobody is running never committed, and is reported
   * failed so the browser offers to send it again. An `imported` one nobody
   * is running has its contacts and no summary, and its check is resumed
   * here in the background. Both are the shape a process death leaves.
   */
  get(scope: Scope, id: string, rid: string): ImportRecord | null {
    const row = read(scope, id);
    if (!row) return null;

    if (row.status === "running" && !live.has(id)) {
      this.fail(scope, id, INTERRUPTED_BEFORE_COMMIT);
      log.warn(
        "Imports",
        `[${rid}] Import ${id} was running with nobody running it. Marked failed.`,
      );
      return toRecord(read(scope, id)!);
    }

    if (row.status === "imported" && !live.has(id)) {
      const createdIds = (
        _stmts.createdIds.all(id, scope.ownerId) as { contactId: string }[]
      ).map((r) => r.contactId);
      log.info(
        "Imports",
        `[${rid}] Import ${id} committed ${createdIds.length} contacts and never finished its check. Resuming.`,
      );
      live.set(id, { ownerId: scope.ownerId });
      runWithContext(
        { requestId: `imp-resume-${id.slice(0, 8)}`, principal: null, scope },
        () => this.finish(scope, id, createdIds, rid),
      ).catch((err) =>
        log.error(
          "Imports",
          `[${rid}] Resumed check for ${id} crashed: ${getErrorMessage(err)}`,
        ),
      );
      return toRecord({ ...row, phase: "scanning", message: "Resuming…" });
    }

    return toRecord(row);
  },

  /** The rows of one import in one status, oldest first. */
  rows(
    scope: Scope,
    id: string,
    status: "done" | "failed",
    limit: number,
  ): ImportRow[] {
    if (!read(scope, id)) throw new NotFoundError("Import", id);
    const rows = _stmts.rows.all(id, scope.ownerId, status, limit) as {
      rowIndex: number;
      status: "done" | "failed";
      name: string | null;
      error: string | null;
      contactId: string | null;
    }[];
    return rows.map((r) => ({
      index: r.rowIndex,
      status: r.status,
      name: r.name,
      error: r.error,
      contactId: r.contactId,
    }));
  },

  /**
   * The failed rows of an import, as the payloads to run again.
   *
   * The route hands these to `bulkCreateContacts` under the same import id
   * with their original indexes, so each row lands back on its own line.
   */
  failedRows(
    scope: Scope,
    id: string,
  ): { indexes: number[]; contacts: NewContactPayload[] } {
    const rows = _stmts.failedPayloads.all(id, scope.ownerId) as {
      rowIndex: number;
      payload: string | null;
    }[];
    const indexes: number[] = [];
    const contacts: NewContactPayload[] = [];
    for (const row of rows) {
      if (!row.payload) continue;
      try {
        contacts.push(JSON.parse(row.payload) as NewContactPayload);
        indexes.push(row.rowIndex);
      } catch {
        // A payload this version cannot read stays failed, with its error.
      }
    }
    return { indexes, contacts };
  },

  /** Claim an import for a retry, or say why not. */
  beginRetry(scope: Scope, id: string): void {
    const row = read(scope, id);
    if (!row) throw new NotFoundError("Import", id);
    if (live.has(id)) throw inProgress(id);
    if (row.status === "running" || row.status === "failed") {
      throw new AppError(
        "Nothing was imported, so there is nothing to retry. Send the import again.",
        400,
        { code: "NOTHING_TO_RETRY" },
      );
    }
    if (row.failed === 0) {
      throw new AppError("Every row of this import was imported.", 400, {
        code: "NOTHING_TO_RETRY",
      });
    }
    live.set(id, { ownerId: scope.ownerId });
    _stmts.phase.run(
      "importing",
      `Retrying ${row.failed} row${row.failed === 1 ? "" : "s"}…`,
      id,
      scope.ownerId,
    );
  },

  /** Give an import back after a retry that threw before it committed. */
  releaseRetry(scope: Scope, id: string): void {
    live.delete(id);
    _stmts.phase.run("done", null, id, scope.ownerId);
  },
};
