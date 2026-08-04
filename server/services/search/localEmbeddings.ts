// =============================================================================
// Local Embedding Service — Zero-Latency Semantic Search Embeddings
// =============================================================================
// Uses @huggingface/transformers (Transformers.js) to run the all-MiniLM-L6-v2
// embedding model directly in-process. This eliminates the Gemini embedding API
// dependency for search queries, providing:
//
// - ~3-5ms query embedding (vs ~150ms+ cloud API)
// - 100% offline capability
// - Zero rate-limit risk
// - ~2s backfill for 960 contacts (vs 30s+ with Gemini)
//
// The model produces 384-dimensional L2-normalized vectors, stored in a
// separate `search_embeddings` vec0 table. The dedupe engine continues
// using Gemini's 768-dim embeddings for higher-accuracy similarity.
// =============================================================================

import path from "path";
import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
// Type-only import — fully erased at compile time, so the runtime module
// graph still loads @huggingface/transformers lazily via dynamic import.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

// =============================================================================
// Types & State
// =============================================================================

/** The HuggingFace pipeline factory function (lazy-loaded via dynamic import). */
let pipelineFactory:
  typeof import("@huggingface/transformers").pipeline | null = null;
/** The initialized feature-extraction pipeline instance. */
let extractor: FeatureExtractionPipeline | null = null;
let modelReady = false;
let initPromise: Promise<void> | null = null;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBED_DIMENSIONS = 384;
const BACKFILL_BATCH_SIZE = 64;

// =============================================================================
// Initialization (lazy singleton)
// =============================================================================

/**
 * Load the local embedding model. Called once on server startup.
 * Uses dynamic import for @huggingface/transformers to avoid
 * blocking the module graph during build.
 */
export async function initLocalEmbeddings(): Promise<void> {
  if (modelReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const t0 = Date.now();
      const { pipeline: createPipeline, env: hfEnv } =
        await import("@huggingface/transformers");
      pipelineFactory = createPipeline;

      // Transformers.js ignores the Python-style TRANSFORMERS_CACHE env var;
      // it only reads env.cacheDir (default: inside node_modules, which is
      // ephemeral in Docker). Persist the model in DATA_DIR when configured.
      const cacheDir =
        process.env.TRANSFORMERS_CACHE ??
        (process.env.DATA_DIR
          ? path.join(process.env.DATA_DIR, ".cache")
          : undefined);
      if (cacheDir) hfEnv.cacheDir = cacheDir;

      extractor = await pipelineFactory("feature-extraction", MODEL_ID, {
        dtype: "q8", // quantized for speed + lower memory
      });

      modelReady = true;
      log.info(
        "LocalEmbeddings",
        `Model ${MODEL_ID} loaded in ${Date.now() - t0}ms (384-dim, q8)`,
      );
    } catch (err: unknown) {
      log.warn(
        "LocalEmbeddings",
        `Failed to load local embedding model: ${getErrorMessage(err)}`,
      );
      modelReady = false;
    }
  })();

  return initPromise;
}

/** Check if the local embedding model is ready. */
export function isLocalEmbeddingReady(): boolean {
  return modelReady;
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Embed a single text string into a 384-dim Float32Array.
 * Returns null if the model isn't ready.
 * Typical latency: ~3-5ms on CPU.
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  if (!modelReady || !extractor) return null;

  const output = await extractor(text, { pooling: "mean", normalize: true });
  const values = output.tolist()[0] as number[];
  const vec = new Float32Array(values);

  // Sanity check: ensure the model produced the expected dimensionality.
  // This guards against silent model swaps by contributors.
  if (vec.length !== EMBED_DIMENSIONS) {
    throw new Error(
      `Expected ${EMBED_DIMENSIONS}-dim vector, got ${vec.length}`,
    );
  }

  return vec;
}

/**
 * Embed multiple texts in a single batch. More efficient than
 * calling embedText() in a loop.
 */
export async function embedBatch(
  texts: string[],
): Promise<(Float32Array | null)[]> {
  if (!modelReady || !extractor || texts.length === 0) return [];

  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const allVecs = output.tolist() as number[][];
  return allVecs.map((v) => new Float32Array(v));
}

// =============================================================================
// Storage: search_embeddings Table Operations
// =============================================================================

/**
 * Upsert a search embedding for a contact.
 */
// Pre-compiled transaction for atomic upsert (vec0 doesn't support ON CONFLICT).
// Wrapping in a transaction prevents a concurrent KNN query from seeing a gap
// between the DELETE and INSERT, and gives a minor perf boost (single journal entry).
const _upsertTxn = sqlite.transaction((contactId: string, buf: Buffer) => {
  sqlite
    .prepare("DELETE FROM search_embeddings WHERE contactId = ?")
    .run(contactId);
  sqlite
    .prepare(
      "INSERT INTO search_embeddings (contactId, embedding) VALUES (?, ?)",
    )
    .run(contactId, buf);
});

export function upsertSearchEmbedding(
  contactId: string,
  embedding: Float32Array,
): void {
  // Defensive copy — Buffer.from(arrayBuffer) is zero-copy, which risks
  // corruption if Transformers.js reclaims the underlying ArrayBuffer.
  const buf = Buffer.from(embedding.buffer.slice(0));
  _upsertTxn(contactId, buf);
}

/**
 * Find K nearest neighbors in the search_embeddings table.
 */
export function findSearchNeighbors(
  queryVec: Float32Array,
  k: number,
  preFilterIds?: Set<string>,
): { contactId: string; distance: number }[] {
  const buf = Buffer.from(queryVec.buffer.slice(0));

  // Brute-force KNN via sqlite-vec — perfect for ~960 rows (<0.5ms).
  // NOTE: If the dataset exceeds ~10K contacts, consider switching to an
  // approximate nearest neighbor index (e.g., HNSW) or pre-filtering in SQL.
  const rows = sqlite
    .prepare(
      `
    SELECT contactId, distance
    FROM search_embeddings
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `,
    )
    .all(buf, Math.min(k, 500)) as { contactId: string; distance: number }[];

  // Apply pre-filter if provided
  if (preFilterIds) {
    return rows.filter((r) => preFilterIds.has(r.contactId));
  }

  return rows;
}

/** Count of contacts with search embeddings. */
export function getSearchEmbeddingCount(): number {
  const row = sqlite
    .prepare("SELECT COUNT(*) as c FROM search_embeddings")
    .get() as { c: number };
  return row.c;
}

// =============================================================================
// Backfill: Embed All Contacts
// =============================================================================

/**
 * Generate and store search embeddings for all contacts that don't have one.
 * Uses the local model — no API calls, no rate limits.
 * ~2s for 960 contacts on Apple Silicon.
 */
export async function backfillSearchEmbeddings(): Promise<number> {
  if (!modelReady) {
    log.warn("LocalEmbeddings", "Cannot backfill: model not loaded");
    return 0;
  }

  const t0 = Date.now();

  // Find contacts missing search embeddings
  const missing = sqlite
    .prepare(
      `
    SELECT c.id, c.name, c.company, c.role, c.location, c.industry,
           c.headline, c.about, c.preferences, c.searchExpansion
    FROM contacts c
    WHERE c.isGhost = 0 AND (c.isArchived = 0 OR c.isArchived IS NULL)
      AND c.canonicalId IS NULL
      AND c.id NOT IN (SELECT contactId FROM search_embeddings)
  `,
    )
    .all() as SearchTextRow[];

  if (missing.length === 0) {
    log.debug("LocalEmbeddings", "All contacts already have search embeddings");
    return 0;
  }

  // Get tags and interests for each contact
  const tagsStmt = sqlite.prepare(
    "SELECT tag FROM contact_tags WHERE contactId = ?",
  );
  const interestsStmt = sqlite.prepare(
    "SELECT interest FROM contact_interests WHERE contactId = ?",
  );
  const deleteStmt = sqlite.prepare(
    "DELETE FROM search_embeddings WHERE contactId = ?",
  );
  const insertStmt = sqlite.prepare(
    "INSERT INTO search_embeddings (contactId, embedding) VALUES (?, ?)",
  );

  let embedded = 0;

  // Process in batches
  for (let i = 0; i < missing.length; i += BACKFILL_BATCH_SIZE) {
    const batch = missing.slice(i, i + BACKFILL_BATCH_SIZE);

    // Build text for each contact
    const texts = batch.map((c) => {
      const tags = (tagsStmt.all(c.id) as { tag: string }[]).map((t) => t.tag);
      const interests = (interestsStmt.all(c.id) as { interest: string }[]).map(
        (t) => t.interest,
      );
      return contactToSearchText(c, tags, interests);
    });

    const vectors = await embedBatch(texts);

    // Store in transaction for speed
    const txn = sqlite.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec) continue;
        const buf = Buffer.from(vec.buffer.slice(0));
        deleteStmt.run(batch[j].id);
        insertStmt.run(batch[j].id, buf);
        embedded++;
      }
    });
    txn();
  }

  log.info(
    "LocalEmbeddings",
    `Backfilled ${embedded} search embeddings in ${Date.now() - t0}ms`,
  );
  return embedded;
}

/**
 * Generate and store a search embedding for a single contact.
 * Called on contact create/update.
 */
export async function embedContact(contactId: string): Promise<void> {
  if (!modelReady) return;

  const row = sqlite
    .prepare(
      `
    SELECT id, name, company, role, location, industry, headline, about, preferences, searchExpansion
    FROM contacts WHERE id = ?
  `,
    )
    .get(contactId) as SearchTextRow | undefined;

  if (!row) return;

  const tags = (
    sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(contactId) as { tag: string }[]
  ).map((t) => t.tag);
  const interests = (
    sqlite
      .prepare("SELECT interest FROM contact_interests WHERE contactId = ?")
      .all(contactId) as { interest: string }[]
  ).map((t) => t.interest);

  const text = contactToSearchText(row, tags, interests);
  const vec = await embedText(text);
  if (!vec) return;

  upsertSearchEmbedding(contactId, vec);
}

// =============================================================================
// Text Representation
// =============================================================================

/** Narrow row of contact columns selected for building search-embedding text. */
interface SearchTextRow {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  location: string | null;
  industry: string | null;
  headline: string | null;
  about: string | null;
  preferences: string | null;
  searchExpansion: string | null;
}

/**
 * Convert a contact row into a text string optimized for search embedding.
 * Includes all searchable fields plus Doc2Query expansion terms.
 */
function contactToSearchText(
  row: SearchTextRow,
  tags: string[],
  interests: string[],
): string {
  const parts: string[] = [];
  if (row.name) parts.push(row.name);
  if (row.company) parts.push(row.company);
  if (row.role) parts.push(row.role);
  if (row.location) parts.push(row.location);
  if (row.industry) parts.push(row.industry);
  if (row.headline) parts.push(row.headline);
  if (row.about) parts.push(row.about.slice(0, 200));
  if (row.preferences) parts.push(row.preferences.slice(0, 200));
  if (tags.length) parts.push(tags.join(", "));
  if (interests.length) parts.push(interests.join(", "));
  if (row.searchExpansion) parts.push(row.searchExpansion);
  return parts.join(" | ");
}
