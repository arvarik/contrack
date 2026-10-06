// Contact embeddings for duplicate detection, stored and searched with
// sqlite-vec.
//
// - The model comes from the embeddings capability, the same setting as
//   semantic search, so "built-in (local)" means nothing leaves the machine.
// - A provider model never embeds the contacts of an account with AI off
//   (mayEmbedContactsFor).
// - Vectors are L2-normalized here, because provider vectors are not always
//   unit length.
// - One backfill at a time. A failed embedding logs a warning and the rest go
//   on.

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
  getEmbeddingsState,
  setEmbeddingsState,
  storeBuiltFor,
} from "../../ai/embeddings.ts";
import {
  currentEmbedder,
  embedderFor,
  isRefused,
  mayEmbedContactsFor,
  whileAllowed,
  type Embedder,
} from "../../ai/embedder.ts";

// Constants

const EMBED_BATCH_SIZE = 64;

/** True when the current embedder, the local model or a provider's, can answer. */
export function isEmbeddingAvailable(): boolean {
  return currentEmbedder().ready();
}

/**
 * Recreate contact_embeddings at a new width (vec0 columns are fixed-size).
 * Exported so a unit test can pin its DDL equal to the partition-key rebuild in
 * db.ts: two copies drifting apart would lose the partition key unnoticed.
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
 * Bring the dedupe vector store in line with the embeddings capability, like
 * ensureEmbeddingStore() for search.
 *
 * @returns the number of contacts embedded again (0 when nothing changed).
 */
export async function ensureDedupeEmbeddingStore(): Promise<number> {
  const embedder = currentEmbedder();

  const dimension = await embedder.dimension();
  if (dimension === null) {
    log.warn(
      "DedupeEmbeddings",
      `Could not determine dimension for ${embedder.id}; keeping the existing vector store`,
    );
    return 0;
  }
  // The capability changed during the probe. That change reconciles itself.
  if (currentEmbedder().id !== embedder.id) return 0;

  const state = getEmbeddingsState("dedupe");
  const changed =
    !state || state.signature !== embedder.id || state.dimension !== dimension;
  if (!changed) return 0;

  if (state) {
    log.info(
      "DedupeEmbeddings",
      `Embeddings changed (${state.signature} → ${embedder.id}); rebuilding dedupe vector store`,
    );
  }
  // Also covers the first boot: db/vec.ts creates the table 768 wide, which
  // does not match a 384-dim local model.
  rebuildDedupeEmbeddingTable(dimension);
  setEmbeddingsState({ signature: embedder.id, dimension }, "dedupe");
  return backfillEmbeddings();
}

/**
 * True when `embedder`'s vectors must not be written: another embedder took
 * over while it was embedding, or the store was built for another one. The
 * store is being rebuilt for the new one, so it never holds two models.
 */
function replaced(embedder: Embedder): boolean {
  return (
    currentEmbedder().id !== embedder.id ||
    !storeBuiltFor(embedder.id, "dedupe")
  );
}

// L2 normalization

/**
 * Normalize a vector to unit length. Gemini normalizes only its full 3072-dim
 * output, and cosine similarity needs unit vectors at the shorter MRL widths.
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

// Embedding generation

/**
 * Embeddings for a batch of texts, through the embedder search uses, so the
 * embeddings capability and the embedder's count guard apply: a backend that
 * returns fewer vectors than inputs is an error. A duplicate check compares one
 * contact's text with another's, so the use is `similarity`.
 *
 * @param items - Array of { id, text } to embed
 * @param embedder - The embedder its caller's checks allowed
 * @returns Map of id → normalized Float32Array
 */
export async function generateBatchEmbeddings(
  items: { id: string; text: string }[],
  embedder = currentEmbedder(),
): Promise<Map<string, Float32Array>> {
  const results = new Map<string, Float32Array>();

  for (let i = 0; i < items.length; i += EMBED_BATCH_SIZE) {
    const batch = items.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const vectors = await embedder.embed(
        batch.map((b) => b.text),
        "similarity",
      );
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (vec) results.set(batch[j].id, l2Normalize(Array.from(vec)));
      }
    } catch (err) {
      // The account turned AI off: nothing more of it is sent.
      if (isRefused(err)) break;
      // One bad batch shouldn't abandon the rest of the backfill.
      log.error(
        "DedupeEmbeddings",
        `Failed to embed batch starting at index ${i}: ${getErrorMessage(err)}`,
      );
    }
  }

  return results;
}

/** One embedding, for a contact create or update. */
export async function generateSingleEmbedding(
  text: string,
  embedder = currentEmbedder(),
): Promise<Float32Array> {
  const [vector] = await embedder.embed([text], "similarity");
  if (!vector) throw new Error("No embedding returned for contact text");
  return l2Normalize(Array.from(vector));
}

// sqlite-vec storage

// Pre-compiled statements for performance
const _stmts = {
  // DELETE then INSERT, never INSERT OR REPLACE: on a partitioned vec0 table
  // sqlite-vec 0.1.9 answers INSERT OR REPLACE with "UNIQUE constraint failed
  // on contact_embeddings primary key" whether or not the partition changes.
  //
  // The owner comes from `contacts` in the same statement, not from the caller:
  // an INSERT that omits a partition key stores NULL silently, and a NULL
  // partition is invisible to every scoped KNN.
  insert: sqlite.prepare(
    `INSERT INTO contact_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
     SELECT c.id, c.ownerId, ${VEC_METADATA_SQL}, ?
       FROM contacts c WHERE c.id = ? AND c.ownerId IS NOT NULL`,
  ),
  // tenant-lint: allow owner-checked by caller
  delete: sqlite.prepare("DELETE FROM contact_embeddings WHERE contactId = ?"),
  // `ownerId` is the partition key, so this counts one owner's chunks. The
  // answer decides whether a scan pays a provider to backfill.
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
  // `ownerId` is the vec0 partition key, so sqlite-vec reads one owner's chunks
  // and neighbors never come from another account. A partition column takes no
  // `IN (...)`, so it is one owner per statement.
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
 * Drop one account's dedupe vectors and metadata, in one transaction so a KNN
 * never sees vectors whose metadata is gone. A full-mode scan starts here. Only
 * this owner's rows go, so another account's next scan does not pay to rebuild.
 */
export const clearOwnerEmbeddings = sqlite.transaction((scope: Scope) => {
  _stmts.clearOwnerMeta.run(scope.ownerId);
  _stmts.clearOwner.run(scope.ownerId);
}) as (scope: Scope) => void;

/** How many of this account's contacts have a dedupe vector. */
export function getEmbeddingCount(scope: Scope): number {
  return (_stmts.count.get(scope.ownerId) as { cnt: number }).cnt;
}

/** A contact's stored embedding, or null. */
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
 * The K nearest neighbors of an embedding.
 *
 * @param scope      - The owner whose vectors are searched
 * @param embedding  - The query vector
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

// Staleness

/** Contacts edited since their embedding was made. */
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
 * Embed contacts edited since their last embedding, during a non-full scan when
 * embeddings already exist.
 *
 * @returns Number of contacts embedded again
 */
export async function reEmbedStaleContacts(scope: Scope): Promise<number> {
  const allowed = currentEmbedder();
  if (!allowed.ready() || !mayEmbedContactsFor(scope.ownerId, allowed))
    return 0;
  const embedder = embedderFor(scope.ownerId, allowed);

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
    // Every id came from the scoped query above, so the scan's own scope reads
    // them. Embedding is provider-billed and must stop at the account that
    // asked.
    const normalized = normalizeContactById(scope, id);
    if (normalized) {
      items.push({ id: normalized.id, text: normalized.embeddingText });
    }
  }

  if (items.length === 0) return 0;

  const embeddings = await generateBatchEmbeddings(items, embedder);
  if (replaced(embedder)) return 0;
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

// Backfill

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
 * Embed one slice and store it. The caller runs this inside the owning
 * account's context, so every provider call bills that account.
 */
async function embedAndStore(
  items: PendingEmbedding[],
  embedder: Embedder,
): Promise<number> {
  if (items.length === 0) return 0;
  const embeddings = await generateBatchEmbeddings(items, embedder);
  if (replaced(embedder)) return 0;
  const entries: { contactId: string; embedding: Float32Array }[] = [];
  for (const [id, emb] of embeddings) {
    entries.push({ contactId: id, embedding: emb });
  }
  storeEmbeddings(entries);
  return entries.length;
}

/**
 * Embed one account's missing contacts, for the duplicate scan. It stays inside
 * that account, so it bills the right person and does not refill other
 * accounts' indexes.
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
  // One embedder for the whole backlog, the one these checks allowed.
  const allowed = currentEmbedder();
  if (!allowed.ready()) {
    log.warn(
      "DedupeEmbeddings",
      "No embedding model is ready — skipping embedding backfill",
    );
    return 0;
  }
  if (!mayEmbedContactsFor(scope.ownerId, allowed)) return 0;
  const embedder = embedderFor(scope.ownerId, allowed);

  _backfillRunning = true;
  try {
    // A background caller has no context, and `recordInvocation` reads the
    // context rather than this argument, so it is set here to bill `scope` from
    // every caller.
    return await runWithContext(
      {
        requestId: `job-dedupe-backfill-${scope.ownerId.slice(0, 8)}`,
        principal: null,
        scope,
      },
      () => embedOwnerBacklog(scope, embedder, onProgress),
    );
  } finally {
    _backfillRunning = false;
  }
}

/** One account's missing contacts, embedded in rounds. No lock, no context. */
async function embedOwnerBacklog(
  scope: Scope,
  embedder: Embedder,
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
    if (replaced(embedder) || !mayEmbedContactsFor(scope.ownerId, embedder))
      break;
    done += await embedAndStore(items.slice(i, i + OWNER_ROUND_SIZE), embedder);
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
 * button. Each round runs inside its own account's context, so the provider
 * spend lands on that account. Owners interleave, so a large account does not
 * hold up a small one. Only contacts missing from contact_embeddings are
 * embedded, and one backfill runs at a time.
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
      "No embedding model is ready — skipping embedding backfill",
    );
    return 0;
  }

  _backfillRunning = true;
  try {
    onProgress?.(0, 0, "Normalizing contacts...");
    const queues: { scope: Scope; items: PendingEmbedding[] }[] = [];
    for (const ownerId of ownersWithContacts()) {
      if (!mayEmbedContactsFor(ownerId)) continue;
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
        // The owner can turn AI off, or an admin can pin another model, while
        // a backfill runs. The round keeps the embedder this check allowed,
        // and asks again before every call.
        const allowed = currentEmbedder();
        if (!mayEmbedContactsFor(queue.scope.ownerId, allowed)) {
          queue.items = [];
          continue;
        }
        const embedder = embedderFor(queue.scope.ownerId, allowed);
        const round = queue.items.splice(0, OWNER_ROUND_SIZE);
        done += await runWithContext(
          {
            requestId: `job-dedupe-backfill-${queue.scope.ownerId.slice(0, 8)}`,
            principal: null,
            scope: queue.scope,
          },
          () => embedAndStore(round, embedder),
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

// One contact at a time

/** In-flight contact IDs — prevents duplicate API calls for the same contact */
const _inFlightIds = new Set<string>();

/**
 * Generate and store one contact's embedding, in the background after a write.
 * A contact already being embedded is skipped.
 *
 * @param contactId - The contact to embed
 * @returns true if successful, false if skipped/failed
 */
export async function generateAndStoreEmbedding(
  contactId: string,
): Promise<boolean> {
  // One embedder for the whole call, the one the checks below allowed.
  const allowed = currentEmbedder();
  if (!allowed.ready()) return false;
  if (_inFlightIds.has(contactId)) {
    log.debug("DedupeEmbeddings", `Skipping ${contactId} — already in-flight`);
    return false;
  }

  _inFlightIds.add(contactId);
  try {
    const scope = scopeOfContact(contactId);
    if (scope && !mayEmbedContactsFor(scope.ownerId, allowed)) return false;
    const normalized = scope && normalizeContactById(scope, contactId);
    if (!scope || !normalized) {
      log.warn(
        "DedupeEmbeddings",
        `Contact ${contactId} not found or has no name — skipping embedding`,
      );
      return false;
    }

    const embedder = embedderFor(scope.ownerId, allowed);
    const embedding = await generateSingleEmbedding(
      normalized.embeddingText,
      embedder,
    );
    if (replaced(embedder)) return false;
    storeEmbedding(contactId, embedding);
    log.debug("DedupeEmbeddings", `Embedded contact ${contactId}`);
    return true;
  } catch (err: unknown) {
    if (isRefused(err)) return false;
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
 * Generate and store embeddings for many contacts, in the background after a
 * bulk create.
 */
export async function generateAndStoreBulkEmbeddings(
  contactIds: string[],
): Promise<number> {
  const allowed = currentEmbedder();
  if (!allowed.ready() || contactIds.length === 0) return 0;

  try {
    // Batch-normalize the specific contacts
    const items: { id: string; text: string }[] = [];
    const owners = new Set<string>();
    for (const id of contactIds) {
      const scope = scopeOfContact(id);
      if (scope && !mayEmbedContactsFor(scope.ownerId, allowed)) continue;
      const normalized = scope && normalizeContactById(scope, id);
      if (scope && normalized) {
        items.push({ id: normalized.id, text: normalized.embeddingText });
        owners.add(scope.ownerId);
      }
    }

    if (items.length === 0) return 0;
    // An import of thousands runs many batches. Every one asks again.
    const embedder = whileAllowed(allowed, () =>
      [...owners].every((owner) => mayEmbedContactsFor(owner, allowed)),
    );

    const embeddings = await generateBatchEmbeddings(items, embedder);
    if (replaced(embedder)) return 0;
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
