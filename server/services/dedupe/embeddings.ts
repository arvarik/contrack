// =============================================================================
// Dedupe Embedding Service — Semantic Contact Embeddings
// =============================================================================
// Generates, stores, and queries contact embeddings for duplicate detection,
// using sqlite-vec for native vector similarity search within SQLite.
//
// The model comes from the *embeddings capability* — the same setting that
// powers semantic search — so "Embeddings: built-in (local)" genuinely means
// nothing leaves the machine. This file previously called Gemini directly
// regardless of that setting, which both ignored the user's choice and sent
// every contact to Google from an app that advertises local-first operation.
//
// Design principles:
// - Model/provider resolved from the embeddings capability, never hardcoded
// - Manual L2 normalization (provider vectors are not always unit length)
// - Float32Array buffer format for sqlite-vec compatibility
// - Concurrency guard: only one backfill at a time
// - Graceful degradation: if embedding fails, log a warning and continue
// =============================================================================

import {
  sqlite,
  vecTableDdl,
  VEC_ACTIVE_MATCH,
  VEC_METADATA_SQL,
} from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { scopeForOwnerId, type Scope } from "../../tenancy/scope.ts";
import { runWithContext } from "../../tenancy/requestContext.ts";
import {
  normalizeContactById,
  normalizeContacts,
  scopeOfContact,
} from "./normalization.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import {
  embedBatch,
  isSearchEmbeddingReady,
} from "../search/localEmbeddings.ts";
import {
  resolveEmbeddings,
  probeDimension,
  getEmbeddingsState,
  setEmbeddingsState,
} from "../../ai/embeddings.ts";

// =============================================================================
// Constants
// =============================================================================

const EMBED_BATCH_SIZE = 64;

/** True when some embedding backend (local model or provider) is usable. */
export function isEmbeddingAvailable(): boolean {
  return isSearchEmbeddingReady();
}

/**
 * Recreate contact_embeddings at a new width. vec0 columns are fixed-size.
 *
 * Exported so a unit test can pin its DDL equal to the one db.ts uses for the
 * partition-key rebuild. Two copies of this string drifting apart is how a
 * table loses its partition key without anyone noticing.
 */
export function rebuildDedupeEmbeddingTable(dimension: number): void {
  sqlite.exec(`DROP TABLE IF EXISTS contact_embeddings`);
  sqlite.exec(vecTableDdl("contact_embeddings", dimension));
  log.info(
    "DedupeEmbeddings",
    `Rebuilt contact_embeddings at ${dimension} dimensions (re-embed required)`,
  );
}

/**
 * Bring the dedupe vector store in line with the embeddings capability,
 * mirroring what ensureEmbeddingStore() does for search. Returns the number
 * of contacts re-embedded (0 when nothing changed).
 */
export async function ensureDedupeEmbeddingStore(): Promise<number> {
  const resolved = resolveEmbeddings();

  let dimension = resolved.dimension;
  if (dimension === null && resolved.providerId && resolved.model) {
    dimension = await probeDimension(resolved.providerId, resolved.model);
  }
  if (dimension === null) {
    log.warn(
      "DedupeEmbeddings",
      `Could not determine dimension for ${resolved.signature}; keeping the existing vector store`,
    );
    return 0;
  }

  const state = getEmbeddingsState("dedupe");
  const changed =
    !state ||
    state.signature !== resolved.signature ||
    state.dimension !== dimension;
  if (!changed) return 0;

  if (state) {
    log.info(
      "DedupeEmbeddings",
      `Embeddings changed (${state.signature} → ${resolved.signature}); rebuilding dedupe vector store`,
    );
  }
  // Also covers first boot after upgrade: db.ts creates the table at the
  // legacy 768 width, which won't match a 384-dim local model.
  rebuildDedupeEmbeddingTable(dimension);
  setEmbeddingsState({ signature: resolved.signature, dimension }, "dedupe");
  return backfillEmbeddings();
}

// =============================================================================
// L2 Normalization
// =============================================================================

/**
 * Normalize a vector to unit length (L2 norm = 1).
 * Required for sub-3072 MRL dimensions — Gemini only auto-normalizes
 * the full 3072-dim output. Truncated outputs need manual normalization
 * to ensure cosine similarity works correctly.
 */
function l2Normalize(values: number[]): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sumSq += values[i] * values[i];
  }
  const norm = Math.sqrt(sumSq);
  const result = new Float32Array(values.length);
  if (norm > 0) {
    for (let i = 0; i < values.length; i++) {
      result[i] = values[i] / norm;
    }
  }
  return result;
}

// =============================================================================
// Core: Embedding Generation
// =============================================================================

/**
 * Generate embeddings for a batch of text strings.
 *
 * Routed through the shared embedding path, so it honors the embeddings
 * capability and inherits its count guard: a backend that returns fewer
 * vectors than inputs is an error, not a silently short batch.
 *
 * @param items      - Array of { id, text } to embed
 * @param onProgress - Optional callback for progress reporting
 * @returns Map of id → normalized Float32Array
 */
export async function generateBatchEmbeddings(
  items: { id: string; text: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, Float32Array>> {
  const results = new Map<string, Float32Array>();

  for (let i = 0; i < items.length; i += EMBED_BATCH_SIZE) {
    const batch = items.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const vectors = await embedBatch(batch.map((b) => b.text));
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (vec) results.set(batch[j].id, l2Normalize(Array.from(vec)));
      }
    } catch (err) {
      // One bad batch shouldn't abandon the rest of the backfill.
      log.error(
        "DedupeEmbeddings",
        `Failed to embed batch starting at index ${i}: ${getErrorMessage(err)}`,
      );
    }
    onProgress?.(Math.min(i + batch.length, items.length), items.length);
  }

  return results;
}

/**
 * Generate a single embedding for one text string.
 * Used for incremental contact create/update.
 */
export async function generateSingleEmbedding(
  text: string,
): Promise<Float32Array> {
  const [vector] = await embedBatch([text]);
  if (!vector) throw new Error("No embedding returned for contact text");
  return l2Normalize(Array.from(vector));
}

// =============================================================================
// Storage: sqlite-vec Operations
// =============================================================================

// Pre-compiled statements for performance
const _stmts = {
  // DELETE then INSERT, never INSERT OR REPLACE. On a partitioned vec0 table
  // sqlite-vec 0.1.9 answers INSERT OR REPLACE with "UNIQUE constraint failed
  // on contact_embeddings primary key" whether or not the partition changes,
  // so the search store's pattern is now the only pattern. Measured on the
  // installed 0.1.9 in the day-one smoke test for this phase.
  //
  // The owner comes from `contacts` in the same transaction rather than from
  // the caller: an INSERT that omits a partition key stores NULL silently, and
  // a NULL partition is invisible to every scoped KNN Phase 2 writes.
  insert: sqlite.prepare(
    `INSERT INTO contact_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
     SELECT c.id, c.ownerId, ${VEC_METADATA_SQL}, ?
       FROM contacts c WHERE c.id = ? AND c.ownerId IS NOT NULL`,
  ),
  // tenant-lint: allow owner-checked by caller
  delete: sqlite.prepare("DELETE FROM contact_embeddings WHERE contactId = ?"),
  // `ownerId` is the partition key, so this counts one owner's chunks rather
  // than reading the table. The dedupe index is per account: a scan asks how
  // many of ITS contacts are embedded, and the answer decides whether the run
  // pays a provider to backfill.
  count: sqlite.prepare(
    "SELECT COUNT(*) AS cnt FROM contact_embeddings WHERE ownerId = ?",
  ),
  exists: sqlite.prepare(
    // tenant-lint: allow owner-checked by caller
    "SELECT 1 FROM contact_embeddings WHERE contactId = ?",
  ),
  get: sqlite.prepare(
    // tenant-lint: allow owner-checked by caller
    "SELECT embedding FROM contact_embeddings WHERE contactId = ?",
  ),
  // `ownerId` is the vec0 partition key, so sqlite-vec reads one owner's
  // chunks rather than the whole table and the neighbours can never come from
  // another account. `ownerId IN (...)` is not supported on a partition
  // column, so this is one owner per statement by design.
  knn: sqlite.prepare(`
    SELECT contactId, distance
    FROM contact_embeddings
    WHERE embedding MATCH ?
      AND ownerId = ?
      AND ${VEC_ACTIVE_MATCH}
      AND k = ?
    ORDER BY distance
  `),
  // Embedding metadata for staleness tracking
  upsertMeta: sqlite.prepare(
    "INSERT OR REPLACE INTO dedupe_embedding_meta (contactId, embeddedAt) VALUES (?, ?)",
  ),
  clearOwner: sqlite.prepare(
    "DELETE FROM contact_embeddings WHERE ownerId = ?",
  ),
  clearOwnerMeta: sqlite.prepare(
    `DELETE FROM dedupe_embedding_meta
      WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)`,
  ),
  deleteMeta: sqlite.prepare(
    "DELETE FROM dedupe_embedding_meta WHERE contactId = ?",
  ),
};

/** Replace one contact's vector. Wrapped so a KNN never sees the gap. */
const _upsertTxn = sqlite.transaction(
  (contactId: string, buf: Buffer, at: string) => {
    _stmts.delete.run(contactId);
    _stmts.insert.run(buf, contactId);
    _stmts.upsertMeta.run(contactId, at);
  },
);

/** Store a single embedding in sqlite-vec and record its timestamp. */
export function storeEmbedding(
  contactId: string,
  embedding: Float32Array,
): void {
  _upsertTxn(
    contactId,
    Buffer.from(embedding.buffer),
    new Date().toISOString(),
  );
}

/** Store multiple embeddings in a single transaction. */
export function storeEmbeddings(
  entries: { contactId: string; embedding: Float32Array }[],
): void {
  const now = new Date().toISOString();
  const txn = sqlite.transaction(() => {
    for (const { contactId, embedding } of entries) {
      _stmts.delete.run(contactId);
      _stmts.insert.run(Buffer.from(embedding.buffer), contactId);
      _stmts.upsertMeta.run(contactId, now);
    }
  });
  txn();
}

/**
 * Drop one account's dedupe index, vectors and metadata together.
 *
 * A full-mode scan re-embeds from scratch, so it starts by throwing the old
 * vectors away. Until 2e that was `DELETE FROM contact_embeddings` with no
 * predicate plus a metadata wipe, so one person choosing "full" erased every
 * other account's dedupe index and made their next scan pay a provider to
 * rebuild it. The two deletes run in one transaction so a KNN never sees
 * vectors whose metadata is already gone.
 */
export const clearOwnerEmbeddings = sqlite.transaction((scope: Scope) => {
  _stmts.clearOwnerMeta.run(scope.ownerId);
  _stmts.clearOwner.run(scope.ownerId);
}) as (scope: Scope) => void;

/** How many of this account's contacts have a dedupe vector. */
export function getEmbeddingCount(scope: Scope): number {
  return (_stmts.count.get(scope.ownerId) as { cnt: number }).cnt;
}

/**
 * Retrieve the stored embedding vector for a contact.
 * Returns null if the contact has no embedding.
 */
export function getEmbedding(contactId: string): Float32Array | null {
  const row = _stmts.get.get(contactId) as { embedding: Buffer } | undefined;
  if (!row) return null;
  return new Float32Array(
    row.embedding.buffer,
    row.embedding.byteOffset,
    row.embedding.byteLength / 4,
  );
}

/**
 * Find the K nearest neighbors for a given embedding vector.
 *
 * @param scope      - The owner whose vectors are searched
 * @param embedding  - The query vector (768-dim Float32Array)
 * @param limit      - Max results to return (default 10)
 * @param excludeId  - Optional contact ID to exclude from results (self-match)
 * @returns Array of { contactId, distance } sorted by ascending distance
 */
export function findNearestNeighbors(
  scope: Scope,
  embedding: Float32Array,
  limit: number = 10,
  excludeId?: string,
): { contactId: string; distance: number }[] {
  // sqlite-vec KNN: fetch extra results to account for potential self-match exclusion
  const fetchLimit = excludeId ? limit + 1 : limit;

  const rows = _stmts.knn.all(
    Buffer.from(embedding.buffer),
    scope.ownerId,
    fetchLimit,
  ) as {
    contactId: string;
    distance: number;
  }[];

  if (excludeId) {
    return rows.filter((r) => r.contactId !== excludeId).slice(0, limit);
  }
  return rows;
}

// =============================================================================
// Embedding Staleness Detection
// =============================================================================

/**
 * Find contacts whose updatedAt is newer than their last embedding timestamp.
 * These contacts have been modified after their embedding was generated and
 * should be re-embedded to reflect current data.
 */
function findStaleEmbeddings(scope: Scope): string[] {
  const rows = sqlite
    .prepare(
      `
    SELECT m.contactId
    FROM dedupe_embedding_meta m
    JOIN contacts c ON c.id = m.contactId
    WHERE c.ownerId = ?
      AND c.updatedAt > m.embeddedAt
      AND c.isGhost = 0
      AND (c.isArchived = 0 OR c.isArchived IS NULL)
      AND c.canonicalId IS NULL
  `,
    )
    .all(scope.ownerId) as { contactId: string }[];
  return rows.map((r) => r.contactId);
}

/**
 * Re-embed contacts whose data has changed since their last embedding.
 * Called during non-full scans when embeddings already exist.
 *
 * @returns Number of contacts re-embedded
 */
export async function reEmbedStaleContacts(scope: Scope): Promise<number> {
  if (!isEmbeddingAvailable()) return 0;

  const staleIds = findStaleEmbeddings(scope);
  if (staleIds.length === 0) {
    log.debug("DedupeEmbeddings", "No stale embeddings found");
    return 0;
  }

  log.info(
    "DedupeEmbeddings",
    `Found ${staleIds.length} stale embedding(s) — re-generating`,
  );

  const items: { id: string; text: string }[] = [];
  for (const id of staleIds) {
    // Every id came out of the scoped query above, so the scan's own scope
    // reads them. Re-embedding is provider-billed: it must stop at the account
    // that asked for the scan.
    const normalized = normalizeContactById(scope, id);
    if (normalized) {
      items.push({ id: normalized.id, text: normalized.embeddingText });
    }
  }

  if (items.length === 0) return 0;

  const embeddings = await generateBatchEmbeddings(items);
  const entries: { contactId: string; embedding: Float32Array }[] = [];
  for (const [id, emb] of embeddings) {
    entries.push({ contactId: id, embedding: emb });
  }
  storeEmbeddings(entries);

  log.info(
    "DedupeEmbeddings",
    `Re-embedded ${entries.length} stale contact(s)`,
  );
  return entries.length;
}

// =============================================================================
// High-Level: Backfill All Contacts
// =============================================================================

let _backfillRunning = false;

/** Owners take turns in rounds of this many contacts. */
const OWNER_ROUND_SIZE = 200;

/** Every account that owns at least one contact. */
function ownersWithContacts(): string[] {
  const rows = sqlite
    .prepare(
      // Every account, on purpose: this is the boot sweep, and the loop that
      // reads it runs each account's batch in its own context.
      // tenant-lint: allow instance sweep
      "SELECT DISTINCT ownerId FROM contacts WHERE ownerId IS NOT NULL",
    )
    .all() as { ownerId: string }[];
  return rows.map((r) => r.ownerId);
}

/** One contact waiting for an embedding. */
interface PendingEmbedding {
  id: string;
  text: string;
}

/** The account's active contacts that have no embedding yet. */
function pendingEmbeddings(scope: Scope): PendingEmbedding[] {
  const normalized = normalizeContacts(scope);
  const already = new Set(
    (
      sqlite
        .prepare("SELECT contactId FROM contact_embeddings WHERE ownerId = ?")
        .all(scope.ownerId) as { contactId: string }[]
    ).map((r) => r.contactId),
  );
  return normalized
    .filter((c) => !already.has(c.id))
    .map((c) => ({ id: c.id, text: c.embeddingText }));
}

/**
 * Embed one slice and store it.
 *
 * The caller runs this inside the owning account's context, so every provider
 * call it makes writes an `ai_invocations` row naming that account.
 */
async function embedAndStore(items: PendingEmbedding[]): Promise<number> {
  if (items.length === 0) return 0;
  const embeddings = await generateBatchEmbeddings(items);
  const entries: { contactId: string; embedding: Float32Array }[] = [];
  for (const [id, emb] of embeddings) {
    entries.push({ contactId: id, embedding: emb });
  }
  storeEmbeddings(entries);
  return entries.length;
}

/**
 * Embed one account's missing contacts.
 *
 * The duplicate scan calls this: a scan runs for one account, and paying a
 * provider to embed every other account's contacts in the middle of it billed
 * the wrong person and re-filled the index a full-mode scan had just cleared
 * for its own account only.
 *
 * @param scope - The account to embed
 * @param onProgress - Callback for progress reporting
 * @returns Number of contacts embedded
 */
export async function backfillOwnerEmbeddings(
  scope: Scope,
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<number> {
  if (_backfillRunning) {
    log.warn("DedupeEmbeddings", "Backfill already in progress — skipping");
    return 0;
  }
  if (!isEmbeddingAvailable()) {
    log.warn(
      "DedupeEmbeddings",
      "Gemini API key not configured — skipping embedding backfill",
    );
    return 0;
  }

  _backfillRunning = true;
  try {
    // The scan that calls this is already inside its own context, but a
    // background caller is not, and `recordInvocation` reads the context
    // rather than this argument. Establishing it here is what makes the
    // provider spend land on `scope` from every caller.
    return await runWithContext(
      {
        requestId: `job-dedupe-backfill-${scope.ownerId.slice(0, 8)}`,
        principal: null,
        scope,
      },
      () => embedOwnerBacklog(scope, onProgress),
    );
  } finally {
    _backfillRunning = false;
  }
}

/** One account's missing contacts, embedded in rounds. No lock, no context. */
async function embedOwnerBacklog(
  scope: Scope,
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<number> {
  onProgress?.(0, 0, "Normalizing contacts...");
  const items = pendingEmbeddings(scope);
  if (items.length === 0) {
    log.info(
      "DedupeEmbeddings",
      "All contacts already have embeddings — nothing to backfill",
    );
    onProgress?.(0, 0, "Complete");
    return 0;
  }

  onProgress?.(0, items.length, "Generating embeddings...");
  let done = 0;
  for (let i = 0; i < items.length; i += OWNER_ROUND_SIZE) {
    done += await embedAndStore(items.slice(i, i + OWNER_ROUND_SIZE));
    onProgress?.(
      done,
      items.length,
      `Embedding ${done}/${items.length} contacts`,
    );
  }

  log.info("DedupeEmbeddings", `Backfill complete: embedded ${done} contacts`);
  onProgress?.(items.length, items.length, "Complete");
  return done;
}

/**
 * Embed every account's missing contacts, one round at a time.
 *
 * Instance-wide on purpose: this is the boot sweep and the operator's repair
 * button, and neither may stop at the rows of whoever pressed it. Each round
 * runs inside its own account's context, so the provider spend lands on the
 * account whose contacts it embedded rather than on the primary admin. Owners
 * interleave so a large account does not hold up a small one's first results.
 *
 * Idempotent — only processes contacts missing from contact_embeddings.
 * Concurrency-safe — only one backfill can run at a time.
 *
 * @param onProgress - Callback for progress reporting
 * @returns Number of contacts embedded
 */
export async function backfillEmbeddings(
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<number> {
  if (_backfillRunning) {
    log.warn("DedupeEmbeddings", "Backfill already in progress — skipping");
    return 0;
  }
  if (!isEmbeddingAvailable()) {
    log.warn(
      "DedupeEmbeddings",
      "Gemini API key not configured — skipping embedding backfill",
    );
    return 0;
  }

  _backfillRunning = true;
  try {
    onProgress?.(0, 0, "Normalizing contacts...");
    const queues: { scope: Scope; items: PendingEmbedding[] }[] = [];
    for (const ownerId of ownersWithContacts()) {
      const scope = scopeForOwnerId(ownerId);
      const items = pendingEmbeddings(scope);
      if (items.length > 0) queues.push({ scope, items });
    }

    const total = queues.reduce((n, q) => n + q.items.length, 0);
    if (total === 0) {
      log.info(
        "DedupeEmbeddings",
        "All contacts already have embeddings — nothing to backfill",
      );
      onProgress?.(0, 0, "Complete");
      return 0;
    }

    log.info(
      "DedupeEmbeddings",
      `${total} contacts need embeddings across ${queues.length} account(s)`,
    );
    onProgress?.(0, total, "Generating embeddings...");

    let done = 0;
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const queue of queues) {
        if (queue.items.length === 0) continue;
        const round = queue.items.splice(0, OWNER_ROUND_SIZE);
        done += await runWithContext(
          {
            requestId: `job-dedupe-backfill-${queue.scope.ownerId.slice(0, 8)}`,
            principal: null,
            scope: queue.scope,
          },
          () => embedAndStore(round),
        );
        onProgress?.(done, total, `Embedding ${done}/${total} contacts`);
        if (queue.items.length > 0) remaining = true;
      }
    }

    log.info(
      "DedupeEmbeddings",
      `Backfill complete: embedded ${done} contacts for ${queues.length} account(s)`,
    );
    onProgress?.(total, total, "Complete");
    return done;
  } finally {
    _backfillRunning = false;
  }
}

// =============================================================================
// High-Level: Generate + Store for a Single Contact (Incremental)
// =============================================================================

/** In-flight contact IDs — prevents duplicate API calls for the same contact */
const _inFlightIds = new Set<string>();

/**
 * Generate and store an embedding for a single contact.
 * Used as a fire-and-forget background task after contact create/update.
 * Concurrency-safe: if the same contactId is already being embedded, skips.
 *
 * @param contactId - The contact to embed
 * @returns true if successful, false if skipped/failed
 */
export async function generateAndStoreEmbedding(
  contactId: string,
): Promise<boolean> {
  if (!isEmbeddingAvailable()) return false;
  if (_inFlightIds.has(contactId)) {
    log.debug("DedupeEmbeddings", `Skipping ${contactId} — already in-flight`);
    return false;
  }

  _inFlightIds.add(contactId);
  try {
    const scope = scopeOfContact(contactId);
    const normalized = scope && normalizeContactById(scope, contactId);
    if (!normalized) {
      log.warn(
        "DedupeEmbeddings",
        `Contact ${contactId} not found or has no name — skipping embedding`,
      );
      return false;
    }

    const embedding = await generateSingleEmbedding(normalized.embeddingText);
    storeEmbedding(contactId, embedding);
    log.debug(
      "DedupeEmbeddings",
      `Embedded contact ${contactId} (${normalized.nameNorm})`,
    );
    return true;
  } catch (err: unknown) {
    log.warn(
      "DedupeEmbeddings",
      `Failed to embed contact ${contactId}: ${getErrorMessage(err)}`,
    );
    return false;
  } finally {
    _inFlightIds.delete(contactId);
  }
}

/**
 * Generate and store embeddings for multiple contacts (bulk import).
 * Used as a fire-and-forget background task after bulk contact creation.
 */
export async function generateAndStoreBulkEmbeddings(
  contactIds: string[],
): Promise<number> {
  if (!isEmbeddingAvailable() || contactIds.length === 0) return 0;

  try {
    // Batch-normalize the specific contacts
    const items: { id: string; text: string }[] = [];
    for (const id of contactIds) {
      const scope = scopeOfContact(id);
      const normalized = scope && normalizeContactById(scope, id);
      if (normalized) {
        items.push({ id: normalized.id, text: normalized.embeddingText });
      }
    }

    if (items.length === 0) return 0;

    const embeddings = await generateBatchEmbeddings(items);
    const entries: { contactId: string; embedding: Float32Array }[] = [];
    for (const [id, emb] of embeddings) {
      entries.push({ contactId: id, embedding: emb });
    }
    storeEmbeddings(entries);

    log.info(
      "DedupeEmbeddings",
      `Bulk embedded ${entries.length}/${contactIds.length} contacts`,
    );
    return entries.length;
  } catch (err: unknown) {
    log.warn(
      "DedupeEmbeddings",
      `Bulk embedding failed: ${getErrorMessage(err)}`,
    );
    return 0;
  }
}
