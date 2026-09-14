import { sqlite } from "../../db.ts";
import { resolveEmbeddings } from "../../ai/embeddings.ts";
import { embedContact } from "./localEmbeddings.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import type { Scope } from "../../tenancy/scope.ts";

const MAX_ATTEMPTS = 3;
const DRAIN_BATCH_SIZE = 50;
const DEFAULT_DEBOUNCE_MS = 250;

let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Ensure the persistent search index queue table exists. */
export function ensureSearchIndexQueueTable(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS search_index_queue (
      contactId TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      queuedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      nextAttemptAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      contactUpdatedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_search_index_queue_status_next
      ON search_index_queue (status, nextAttemptAt);
    CREATE INDEX IF NOT EXISTS idx_search_index_queue_owner
      ON search_index_queue (ownerId, status);
  `);
}

/**
 * Recover any jobs left in 'processing' state (e.g. from an ungraceful shutdown)
 * and kick off the queue if background jobs are enabled.
 */
export function initSearchIndexQueue(): void {
  ensureSearchIndexQueueTable();
  try {
    sqlite
      .prepare(
        "UPDATE search_index_queue SET status = 'pending' WHERE status = 'processing'",
      )
      .run();
  } catch {
    /* table may not exist yet during initial migrations */
  }

  if (process.env.DISABLE_BACKGROUND_JOBS !== "true") {
    triggerIndexDrain(1000);
  }
}

/** Check whether the queue worker is actively draining. */
export function isIndexQueueRunning(): boolean {
  return running;
}

/**
 * Trigger a debounced drain of the indexing queue.
 */
export function triggerIndexDrain(delayMs = DEFAULT_DEBOUNCE_MS): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void drainIndexQueue();
  }, delayMs);
  timer.unref();
}

export interface DrainOptions {
  /** Maximum number of items to drain in one call. Defaults to 50. */
  maxItems?: number;
  /** Alias for maxItems. */
  maxBatchSize?: number;
  /** Allow draining using a paid provider model. If false/omitted, paid models are skipped. */
  allowProvider?: boolean;
}

/** Reset in-memory queue runner state for test isolation. */
export function _resetIndexQueueStateForTest(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
}

export interface DrainResult {
  processed: number;
  succeeded: number;
  failed: number;
  outdated: number;
  skipped: number;
  deferredProvider: number;
}

/**
 * Drain pending indexing tasks from the persistent SQLite queue.
 *
 * Automatic refreshes run with the built-in local model. Provider embeddings
 * are kept explicit unless `allowProvider: true` is passed. Temporary failures
 * are retried with exponential backoff up to MAX_ATTEMPTS. Outdated results
 * (where the contact changed during embedding generation) are rejected.
 */
export async function drainIndexQueue(
  options: DrainOptions = {},
): Promise<DrainResult> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (running) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      outdated: 0,
      skipped: 0,
      deferredProvider: 0,
    };
  }

  ensureSearchIndexQueueTable();

  const resolved = resolveEmbeddings();
  const isProvider = resolved.kind !== "builtin";

  // Keep paid provider refreshes explicit: if configured with a provider,
  // do not automatically drain in the background without explicit permission.
  if (isProvider && !options.allowProvider) {
    const pendingCount = (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM search_index_queue WHERE status = 'pending'",
        )
        .get() as { c: number }
    ).c;
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      outdated: 0,
      skipped: 0,
      deferredProvider: pendingCount,
    };
  }

  running = true;
  const result: DrainResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    outdated: 0,
    skipped: 0,
    deferredProvider: 0,
  };

  try {
    const limit = options.maxItems ?? options.maxBatchSize ?? DRAIN_BATCH_SIZE;
    const seenInThisDrain = new Set<string>();

    while (result.processed < limit) {
      const remainingLimit = limit - result.processed;
      const candidates = sqlite
        .prepare(
          `SELECT contactId, ownerId, attempts, contactUpdatedAt
           FROM search_index_queue
           WHERE status = 'pending' AND nextAttemptAt <= datetime('now')
           ORDER BY queuedAt ASC
           LIMIT ?`,
        )
        .all(remainingLimit) as {
        contactId: string;
        ownerId: string;
        attempts: number;
        contactUpdatedAt: string | null;
      }[];

      const batch = candidates.filter(
        (item) => !seenInThisDrain.has(item.contactId),
      );
      if (batch.length === 0) break;

      for (const item of batch) {
        seenInThisDrain.add(item.contactId);
        result.processed++;

        // Mark item as processing atomically
        const claimed = sqlite
          .prepare(
            "UPDATE search_index_queue SET status = 'processing' WHERE contactId = ? AND status = 'pending'",
          )
          .run(item.contactId);

        if (claimed.changes === 0) {
          // Another worker claimed or modified this row
          continue;
        }

        try {
          const embedRes = await embedContact(item.contactId);

          if (embedRes.status === "indexed") {
            // Delete only if still in 'processing'. If a newer edit occurred
            // while embedContact was running, scheduleSearchIndex set it back to 'pending'.
            const del = sqlite
              .prepare(
                "DELETE FROM search_index_queue WHERE contactId = ? AND status = 'processing'",
              )
              .run(item.contactId);
            if (del.changes > 0) {
              result.succeeded++;
            } else {
              result.outdated++;
            }
          } else if (embedRes.status === "outdated") {
            result.outdated++;
            // Contact was edited or model changed while computing. Keep in pending with 1s next attempt.
            sqlite
              .prepare(
                `UPDATE search_index_queue
                 SET status = 'pending', nextAttemptAt = datetime('now', '+1 second')
                 WHERE contactId = ? AND status = 'processing'`,
              )
              .run(item.contactId);
          } else if (embedRes.status === "skipped") {
            result.skipped++;
            if (embedRes.reason === "inactive_or_deleted") {
              sqlite
                .prepare("DELETE FROM search_index_queue WHERE contactId = ?")
                .run(item.contactId);
            } else {
              // Not ready: re-queue with brief backoff
              sqlite
                .prepare(
                  `UPDATE search_index_queue
                   SET status = 'pending', nextAttemptAt = datetime('now', '+2 seconds')
                   WHERE contactId = ? AND status = 'processing'`,
                )
                .run(item.contactId);
            }
          }
        } catch (error: unknown) {
          result.failed++;
          const attempts = item.attempts + 1;
          const errorMessage = getErrorMessage(error);
          const backoffSeconds = Math.min(Math.pow(2, attempts), 60);

          if (attempts < MAX_ATTEMPTS) {
            log.warn(
              "SearchIndex",
              `Refresh failed for ${item.contactId} (attempt ${attempts}/${MAX_ATTEMPTS}), retrying in ${backoffSeconds}s: ${errorMessage}`,
            );
            sqlite
              .prepare(
                `UPDATE search_index_queue
                 SET status = 'pending',
                     attempts = ?,
                     lastError = ?,
                     nextAttemptAt = datetime('now', '+' || ? || ' seconds')
                 WHERE contactId = ? AND status = 'processing'`,
              )
              .run(attempts, errorMessage, backoffSeconds, item.contactId);

            triggerIndexDrain(backoffSeconds * 1000);
          } else {
            log.error(
              "SearchIndex",
              `Refresh permanently failed for ${item.contactId} after ${attempts} attempts: ${errorMessage}`,
            );
            sqlite
              .prepare(
                `UPDATE search_index_queue
                 SET status = 'failed',
                     attempts = ?,
                     lastError = ?
                 WHERE contactId = ? AND status = 'processing'`,
              )
              .run(attempts, errorMessage, item.contactId);
          }
        }
      }
    }
  } finally {
    running = false;

    // Check if more retries or items are pending
    const remaining = (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM search_index_queue WHERE status = 'pending' AND nextAttemptAt <= datetime('now')",
        )
        .get() as { c: number }
    ).c;
    if (remaining > 0 && (!isProvider || options.allowProvider)) {
      triggerIndexDrain(100);
    }
  }

  return result;
}

/**
 * Coalesce local indexing after edits. FTS updates in the contact transaction.
 *
 * Saves pending indexing work durably into SQLite. If a previous indexing job
 * for this contact was pending, processing, or failed, it resets it with the new
 * contact timestamp so newer edits supersede older attempts.
 */
export function scheduleSearchIndex(id: string): void {
  ensureSearchIndexQueueTable();

  sqlite
    .prepare(
      // Three callers, and each has already proved the caller owns this
      // contact: contactService after a create or update, mergeEngine after a
      // scoped batch applies, and dedupe/merging after loadMergePair. The
      // column is a derived cache, and clearing it queues a re-index.
      // tenant-lint: allow owner-checked by caller
      "UPDATE contacts SET searchExpansion = NULL WHERE id = ? AND searchExpansion IS NOT NULL",
    )
    .run(id);

  // Persist the task in SQLite. If already queued or failed, reset to pending with attempts=0.
  sqlite
    .prepare(
      `INSERT INTO search_index_queue (contactId, ownerId, status, attempts, queuedAt, nextAttemptAt, contactUpdatedAt)
       SELECT c.id, c.ownerId, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, c.updatedAt
       FROM contacts c
       WHERE c.id = ? AND ${ACTIVE_CONTACT_SQL}
       ON CONFLICT(contactId) DO UPDATE SET
         status = 'pending',
         ownerId = excluded.ownerId,
         attempts = 0,
         lastError = NULL,
         queuedAt = CURRENT_TIMESTAMP,
         nextAttemptAt = CURRENT_TIMESTAMP,
         contactUpdatedAt = excluded.contactUpdatedAt`,
    )
    .run(id);

  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  triggerIndexDrain(DEFAULT_DEBOUNCE_MS);
}

/** Enqueue all missing (or all if forceAll) contacts for a specific account. */
export function enqueueMissingContactsForOwner(
  ownerId: string,
  forceAll = false,
): number {
  ensureSearchIndexQueueTable();

  if (forceAll) {
    sqlite
      .prepare("DELETE FROM search_embeddings WHERE ownerId = ?")
      .run(ownerId);
    sqlite
      .prepare("DELETE FROM search_index_queue WHERE ownerId = ?")
      .run(ownerId);

    const res = sqlite
      .prepare(
        `INSERT INTO search_index_queue (contactId, ownerId, status, attempts, queuedAt, nextAttemptAt, contactUpdatedAt)
         SELECT c.id, c.ownerId, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, c.updatedAt
         FROM contacts c
         WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}`,
      )
      .run(ownerId);
    return res.changes;
  }

  // Missing only: active contacts not in search_embeddings or failed in queue
  const res = sqlite
    .prepare(
      `INSERT INTO search_index_queue (contactId, ownerId, status, attempts, queuedAt, nextAttemptAt, contactUpdatedAt)
       SELECT c.id, c.ownerId, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, c.updatedAt
       FROM contacts c
       WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
         AND (c.id NOT IN (SELECT contactId FROM search_embeddings)
              OR c.id IN (SELECT contactId FROM search_index_queue WHERE ownerId = ? AND status = 'failed'))
       ON CONFLICT(contactId) DO UPDATE SET
         status = 'pending',
         attempts = 0,
         lastError = NULL,
         queuedAt = CURRENT_TIMESTAMP,
         nextAttemptAt = CURRENT_TIMESTAMP,
         contactUpdatedAt = excluded.contactUpdatedAt`,
    )
    .run(ownerId, ownerId);

  return res.changes;
}

export interface FailedIndexItem {
  contactId: string;
  name: string;
  error: string;
  attempts: number;
  queuedAt: string;
}

export interface SearchCoverage {
  total: number;
  indexed: number;
  missing: number;
  pending: number;
  failed: number;
  coverage: number;
  isIndexing: boolean;
  provider: {
    kind: "builtin" | "provider";
    providerId: string | null;
    model: string | null;
    isPaid: boolean;
  };
  failedItems: FailedIndexItem[];
}

/**
 * Report account-level semantic search coverage and queue health.
 */
export function getSearchCoverage(scope: Scope): SearchCoverage {
  ensureSearchIndexQueueTable();

  const total = (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS total FROM contacts c
         WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}`,
      )
      .get(scope.ownerId) as { total: number }
  ).total;

  const indexed = (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS indexed
         FROM contacts c
         JOIN search_embeddings e ON e.contactId = c.id
         WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}`,
      )
      .get(scope.ownerId) as { indexed: number }
  ).indexed;

  const queueStats = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM search_index_queue
       WHERE ownerId = ?`,
    )
    .get(scope.ownerId) as {
    pending: number;
    processing: number;
    failed: number;
  };

  const failedItems = sqlite
    .prepare(
      `SELECT q.contactId, COALESCE(c.name, 'Unknown') AS name, COALESCE(q.lastError, 'Unknown error') AS error, q.attempts, q.queuedAt
       FROM search_index_queue q
       LEFT JOIN contacts c ON c.id = q.contactId
       WHERE q.ownerId = ? AND q.status = 'failed'
       ORDER BY q.queuedAt DESC
       LIMIT 10`,
    )
    .all(scope.ownerId) as FailedIndexItem[];

  const missing = Math.max(0, total - indexed);
  const coverage = total > 0 ? Math.round((indexed / total) * 100) : 100;
  const resolved = resolveEmbeddings();

  return {
    total,
    indexed,
    missing,
    pending: queueStats.pending + queueStats.processing,
    failed: queueStats.failed,
    coverage,
    isIndexing: running,
    provider: {
      kind: resolved.kind,
      providerId: resolved.providerId ?? null,
      model: resolved.model ?? null,
      isPaid: resolved.kind === "provider",
    },
    failedItems,
  };
}

/** Remove a contact from the indexing queue (e.g. on soft or hard delete). */
export function removeFromIndexQueue(contactId: string): void {
  ensureSearchIndexQueueTable();
  sqlite
    .prepare("DELETE FROM search_index_queue WHERE contactId = ?")
    .run(contactId);
}

/** Clean up queue entries when an owner is purged. */
export function purgeOwnerFromIndexQueue(ownerId: string): void {
  ensureSearchIndexQueueTable();
  sqlite
    .prepare("DELETE FROM search_index_queue WHERE ownerId = ?")
    .run(ownerId);
}
