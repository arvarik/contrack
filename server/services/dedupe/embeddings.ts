// =============================================================================
// Dedupe Embedding Service — Semantic Contact Embeddings via Gemini
// =============================================================================
// Generates, stores, and queries 768-dimensional contact embeddings using
// Google's gemini-embedding-2-preview model and sqlite-vec for native
// vector similarity search within SQLite.
//
// Design principles:
// - Uses @google/genai SDK directly (not the AI adapter — no fallback chain needed)
// - Manual L2 normalization for sub-3072 MRL dimensions
// - Float32Array buffer format for sqlite-vec compatibility
// - Exponential backoff on rate limit errors
// - Concurrency guard: only one backfill at a time
// - Graceful degradation: if API fails, log warning and continue
// =============================================================================

import { GoogleGenAI } from "@google/genai";
import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { normalizeContacts, normalizeContactById } from "./normalization.ts";

// =============================================================================
// Constants
// =============================================================================

const EMBED_MODEL = "gemini-embedding-2-preview";
const EMBED_DIMENSIONS = 768;     // MRL truncation: 3072 → 768 (~2% quality loss, 4× storage savings)
const EMBED_BATCH_SIZE = 100;     // Gemini limit per request
const MAX_RETRIES = 4;            // Exponential backoff: 1s → 2s → 4s → 8s
const BASE_RETRY_MS = 1000;

// =============================================================================
// Gemini Client (lazy initialization)
// =============================================================================

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "dummy_key") {
      throw new Error("GEMINI_API_KEY not configured — cannot generate embeddings");
    }
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

/** Returns true if the Gemini API key is configured and non-dummy. */
export function isEmbeddingAvailable(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return !!(key && key !== "dummy_key");
}

// =============================================================================
// Error Classification
// =============================================================================

function isRetryableError(error: any): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted") ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("deadline") ||
    msg.includes("timeout")
  );
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
 * Generate embeddings for a batch of text strings via Gemini API.
 * Handles batching (max 100 per request), rate limiting, and normalization.
 *
 * @param items   - Array of { id, text } to embed
 * @param onProgress - Optional callback for progress reporting
 * @returns Map of id → normalized Float32Array (768-dim)
 */
export async function generateBatchEmbeddings(
  items: { id: string; text: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, Float32Array>> {
  const client = getClient();
  const results = new Map<string, Float32Array>();

  for (let i = 0; i < items.length; i += EMBED_BATCH_SIZE) {
    const batch = items.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(b => b.text);

    let response: any = null;
    let lastError: Error | null = null;

    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await client.models.embedContent({
          model: EMBED_MODEL,
          contents: texts,
          config: { outputDimensionality: EMBED_DIMENSIONS },
        });
        break; // success
      } catch (err: any) {
        lastError = err;
        if (isRetryableError(err) && attempt < MAX_RETRIES) {
          const delayMs = BASE_RETRY_MS * Math.pow(2, attempt);
          log.warn("DedupeEmbeddings", `Rate limited on batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          throw err;
        }
      }
    }

    if (!response?.embeddings) {
      log.error("DedupeEmbeddings", `Failed to embed batch starting at index ${i}: ${lastError?.message}`);
      continue; // skip this batch, process rest
    }

    // Extract and normalize each embedding
    for (let j = 0; j < batch.length; j++) {
      const embedding = response.embeddings[j];
      if (embedding?.values) {
        results.set(batch[j].id, l2Normalize(embedding.values));
      }
    }

    onProgress?.(Math.min(i + batch.length, items.length), items.length);
  }

  return results;
}

/**
 * Generate a single embedding for one text string.
 * Used for incremental contact create/update.
 */
export async function generateSingleEmbedding(text: string): Promise<Float32Array> {
  const client = getClient();

  const response = await client.models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { outputDimensionality: EMBED_DIMENSIONS },
  });

  if (!response.embeddings?.[0]?.values) {
    throw new Error("No embedding returned from Gemini API");
  }

  return l2Normalize(response.embeddings[0].values);
}

// =============================================================================
// Storage: sqlite-vec Operations
// =============================================================================

// Pre-compiled statements for performance
const _stmts = {
  upsert: sqlite.prepare(
    "INSERT OR REPLACE INTO contact_embeddings (contactId, embedding) VALUES (?, ?)"
  ),
  delete: sqlite.prepare(
    "DELETE FROM contact_embeddings WHERE contactId = ?"
  ),
  count: sqlite.prepare(
    "SELECT COUNT(*) AS cnt FROM contact_embeddings"
  ),
  exists: sqlite.prepare(
    "SELECT 1 FROM contact_embeddings WHERE contactId = ?"
  ),
  get: sqlite.prepare(
    "SELECT embedding FROM contact_embeddings WHERE contactId = ?"
  ),
  knn: sqlite.prepare(`
    SELECT contactId, distance
    FROM contact_embeddings
    WHERE embedding MATCH ?
      AND k = ?
    ORDER BY distance
  `),
  // Embedding metadata for staleness tracking
  upsertMeta: sqlite.prepare(
    "INSERT OR REPLACE INTO dedupe_embedding_meta (contactId, embeddedAt) VALUES (?, ?)"
  ),
  clearMeta: sqlite.prepare(
    "DELETE FROM dedupe_embedding_meta"
  ),
  deleteMeta: sqlite.prepare(
    "DELETE FROM dedupe_embedding_meta WHERE contactId = ?"
  ),
};

/** Store a single embedding in sqlite-vec and record its timestamp. */
export function storeEmbedding(contactId: string, embedding: Float32Array): void {
  _stmts.upsert.run(contactId, Buffer.from(embedding.buffer));
  _stmts.upsertMeta.run(contactId, new Date().toISOString());
}

/** Store multiple embeddings in a single transaction. */
export function storeEmbeddings(entries: { contactId: string; embedding: Float32Array }[]): void {
  const now = new Date().toISOString();
  const txn = sqlite.transaction(() => {
    for (const { contactId, embedding } of entries) {
      _stmts.upsert.run(contactId, Buffer.from(embedding.buffer));
      _stmts.upsertMeta.run(contactId, now);
    }
  });
  txn();
}

/** Delete an embedding (e.g., when a contact is deleted). */
export function deleteEmbedding(contactId: string): void {
  _stmts.delete.run(contactId);
  _stmts.deleteMeta.run(contactId);
}

/** Clear all embedding metadata (used on full scan reset). */
export function clearEmbeddingMeta(): void {
  _stmts.clearMeta.run();
}

/** Get the total number of stored embeddings. */
export function getEmbeddingCount(): number {
  return (_stmts.count.get() as any).cnt;
}

/** Check if a contact has an embedding. */
export function hasEmbedding(contactId: string): boolean {
  return !!_stmts.exists.get(contactId);
}

/**
 * Retrieve the stored embedding vector for a contact.
 * Returns null if the contact has no embedding.
 */
export function getEmbedding(contactId: string): Float32Array | null {
  const row = _stmts.get.get(contactId) as { embedding: Buffer } | undefined;
  if (!row) return null;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
}

/**
 * Find the K nearest neighbors for a given embedding vector.
 *
 * @param embedding  - The query vector (768-dim Float32Array)
 * @param limit      - Max results to return (default 10)
 * @param excludeId  - Optional contact ID to exclude from results (self-match)
 * @returns Array of { contactId, distance } sorted by ascending distance
 */
export function findNearestNeighbors(
  embedding: Float32Array,
  limit: number = 10,
  excludeId?: string,
): { contactId: string; distance: number }[] {
  // sqlite-vec KNN: fetch extra results to account for potential self-match exclusion
  const fetchLimit = excludeId ? limit + 1 : limit;

  const rows = _stmts.knn.all(
    Buffer.from(embedding.buffer),
    fetchLimit,
  ) as { contactId: string; distance: number }[];

  if (excludeId) {
    return rows.filter(r => r.contactId !== excludeId).slice(0, limit);
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
function findStaleEmbeddings(): string[] {
  const rows = sqlite.prepare(`
    SELECT m.contactId
    FROM dedupe_embedding_meta m
    JOIN contacts c ON c.id = m.contactId
    WHERE c.updatedAt > m.embeddedAt
      AND c.isGhost = 0
      AND (c.isArchived = 0 OR c.isArchived IS NULL)
      AND c.canonicalId IS NULL
  `).all() as { contactId: string }[];
  return rows.map(r => r.contactId);
}

/**
 * Re-embed contacts whose data has changed since their last embedding.
 * Called during non-full scans when embeddings already exist.
 * 
 * @returns Number of contacts re-embedded
 */
export async function reEmbedStaleContacts(): Promise<number> {
  if (!isEmbeddingAvailable()) return 0;

  const staleIds = findStaleEmbeddings();
  if (staleIds.length === 0) {
    log.debug("DedupeEmbeddings", "No stale embeddings found");
    return 0;
  }

  log.info("DedupeEmbeddings", `Found ${staleIds.length} stale embedding(s) — re-generating`);

  const items: { id: string; text: string }[] = [];
  for (const id of staleIds) {
    const normalized = normalizeContactById(id);
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

  log.info("DedupeEmbeddings", `Re-embedded ${entries.length} stale contact(s)`);
  return entries.length;
}

// =============================================================================
// High-Level: Backfill All Contacts
// =============================================================================

let _backfillRunning = false;

/**
 * Generate and store embeddings for all active contacts that don't yet have one.
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
    log.warn("DedupeEmbeddings", "Gemini API key not configured — skipping embedding backfill");
    return 0;
  }

  _backfillRunning = true;
  try {
    // 1. Normalize all active contacts
    onProgress?.(0, 0, "Normalizing contacts...");
    const normalized = normalizeContacts();
    log.info("DedupeEmbeddings", `Normalized ${normalized.length} contacts for embedding`);

    // 2. Filter to contacts missing embeddings
    const existingIds = new Set<string>();
    const allEmbedded = sqlite.prepare(
      "SELECT contactId FROM contact_embeddings"
    ).all() as { contactId: string }[];
    for (const row of allEmbedded) existingIds.add(row.contactId);

    const toEmbed = normalized.filter(c => !existingIds.has(c.id));
    if (toEmbed.length === 0) {
      log.info("DedupeEmbeddings", "All contacts already have embeddings — nothing to backfill");
      onProgress?.(normalized.length, normalized.length, "Complete");
      return 0;
    }

    log.info("DedupeEmbeddings", `${toEmbed.length} contacts need embeddings (${existingIds.size} already done)`);

    // 3. Build embedding text inputs
    const items = toEmbed.map(c => ({ id: c.id, text: c.embeddingText }));

    // 4. Generate embeddings in batches
    onProgress?.(0, items.length, "Generating embeddings...");
    const embeddings = await generateBatchEmbeddings(items, (done, total) => {
      onProgress?.(done, total, `Embedding batch ${Math.ceil(done / EMBED_BATCH_SIZE)}/${Math.ceil(total / EMBED_BATCH_SIZE)}`);
    });

    // 5. Store all embeddings in a single transaction
    onProgress?.(items.length, items.length, "Storing embeddings...");
    const entries: { contactId: string; embedding: Float32Array }[] = [];
    for (const [id, emb] of embeddings) {
      entries.push({ contactId: id, embedding: emb });
    }
    storeEmbeddings(entries);

    log.info("DedupeEmbeddings", `Backfill complete: embedded ${entries.length} contacts`);
    onProgress?.(items.length, items.length, "Complete");
    return entries.length;

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
export async function generateAndStoreEmbedding(contactId: string): Promise<boolean> {
  if (!isEmbeddingAvailable()) return false;
  if (_inFlightIds.has(contactId)) {
    log.debug("DedupeEmbeddings", `Skipping ${contactId} — already in-flight`);
    return false;
  }

  _inFlightIds.add(contactId);
  try {
    const normalized = normalizeContactById(contactId);
    if (!normalized) {
      log.warn("DedupeEmbeddings", `Contact ${contactId} not found or has no name — skipping embedding`);
      return false;
    }

    const embedding = await generateSingleEmbedding(normalized.embeddingText);
    storeEmbedding(contactId, embedding);
    log.debug("DedupeEmbeddings", `Embedded contact ${contactId} (${normalized.nameNorm})`);
    return true;
  } catch (err: any) {
    log.warn("DedupeEmbeddings", `Failed to embed contact ${contactId}: ${err.message}`);
    return false;
  } finally {
    _inFlightIds.delete(contactId);
  }
}

/**
 * Generate and store embeddings for multiple contacts (bulk import).
 * Used as a fire-and-forget background task after bulk contact creation.
 */
export async function generateAndStoreBulkEmbeddings(contactIds: string[]): Promise<number> {
  if (!isEmbeddingAvailable() || contactIds.length === 0) return 0;

  try {
    // Batch-normalize the specific contacts
    const items: { id: string; text: string }[] = [];
    for (const id of contactIds) {
      const normalized = normalizeContactById(id);
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

    log.info("DedupeEmbeddings", `Bulk embedded ${entries.length}/${contactIds.length} contacts`);
    return entries.length;
  } catch (err: any) {
    log.warn("DedupeEmbeddings", `Bulk embedding failed: ${err.message}`);
    return 0;
  }
}
