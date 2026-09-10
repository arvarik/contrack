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
import { sqlite, vecTableDdl } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import { scopeForOwnerId, type Scope } from "../../tenancy/scope.ts";
import { runWithContext } from "../../tenancy/requestContext.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import {
  resolveEmbeddings,
  embedWithProvider,
  probeDimension,
  getEmbeddingsState,
  setEmbeddingsState,
  BUILTIN_DIMENSION,
} from "../../ai/embeddings.ts";
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
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
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

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
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
  const [vector] = await embedTexts([text]);
  return vector ?? null;
}

/**
 * Embed one or more texts using the configured embeddings capability.
 *
 * Routes to the pinned provider model when the embeddings capability is
 * configured, otherwise to the bundled local model. Returns an empty array
 * when no backend is available (search degrades to FTS-only).
 */
async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const resolved = resolveEmbeddings();

  if (resolved.kind === "provider" && resolved.providerId && resolved.model) {
    const vectors = await embedWithProvider(
      resolved.providerId,
      resolved.model,
      texts,
    );
    return vectors.map((v) => new Float32Array(v));
  }

  if (!modelReady || !extractor) return [];
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const rows = output.tolist() as number[][];
  return rows.map((values) => {
    const vec = new Float32Array(values);
    // Guards against a silent local-model swap by a contributor.
    if (vec.length !== BUILTIN_DIMENSION) {
      throw new AppError(
        `Expected ${BUILTIN_DIMENSION}-dim vector from the built-in model, got ${vec.length}`,
      );
    }
    return vec;
  });
}

/**
 * Embed multiple texts in a single batch. More efficient than
 * calling embedText() in a loop.
 */
export async function embedBatch(
  texts: string[],
): Promise<(Float32Array | null)[]> {
  return embedTexts(texts);
}

/**
 * True when *some* embedding backend is usable: either the local model has
 * loaded or a provider model is configured for the embeddings capability.
 */
export function isSearchEmbeddingReady(): boolean {
  const resolved = resolveEmbeddings();
  if (resolved.kind === "provider") return true;
  return modelReady;
}

/**
 * Recreate the search_embeddings vec0 table at a new dimension.
 * vec0 tables have a fixed width, so changing embedding models requires a
 * rebuild; every contact is then re-embedded by backfillSearchEmbeddings().
 */
export function rebuildSearchEmbeddingTable(dimension: number): void {
  sqlite.exec(`DROP TABLE IF EXISTS search_embeddings`);
  // The DDL comes from db.ts so a model change cannot silently recreate the
  // table without its partition key, which would make every scoped KNN in
  // Phase 2 return nothing. A unit test pins the two call sites equal.
  sqlite.exec(vecTableDdl("search_embeddings", dimension));
  log.info(
    "LocalEmbeddings",
    `Rebuilt search_embeddings at ${dimension} dimensions (re-embed required)`,
  );
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
//
// The owner is read from `contacts` inside the same transaction rather than
// taken as an argument. sqlite-vec accepts an INSERT that omits a partition
// key and stores NULL without complaint, so a caller passing the wrong owner,
// or none, would produce a row that every scoped KNN in Phase 2 skips and no
// test notices. Reading it here makes "the vector's owner is its contact's
// owner" true by construction.
const _upsertTxn = sqlite.transaction((contactId: string, buf: Buffer) => {
  const owner = sqlite
    .prepare(
      // tenant-lint: allow owner-checked by caller
      "SELECT ownerId FROM contacts WHERE id = ?",
    )
    .get(contactId) as { ownerId: string | null } | undefined;
  // No contact means the vector would be an orphan with a NULL partition.
  if (!owner?.ownerId) return;
  sqlite
    // tenant-lint: allow owner-checked by caller
    .prepare("DELETE FROM search_embeddings WHERE contactId = ?")
    .run(contactId);
  sqlite
    .prepare(
      "INSERT INTO search_embeddings (contactId, ownerId, embedding) VALUES (?, ?, ?)",
    )
    .run(contactId, owner.ownerId, buf);
});

export function upsertSearchEmbedding(
  contactId: string,
  embedding: Float32Array,
): void {
  // Defensive copy — Buffer.from(arrayBuffer) is zero-copy, which risks
  // corruption if Transformers.js reclaims the underlying ArrayBuffer.
  const buf = Buffer.from(new Float32Array(embedding).buffer);
  _upsertTxn(contactId, buf);
}

/**
 * Find K nearest neighbors among one owner's search vectors.
 *
 * `ownerId` is the vec0 partition key, so sqlite-vec reads that owner's chunks
 * and nothing else. This is a correctness fix before it is a speed one: the
 * global KNN fetched the instance-wide top k and filtered afterwards, so an
 * owner with 200 contacts on an instance of 40,000 would rarely appear in the
 * top 100 and their vector channel returned nothing. The architecture
 * document, section 7, has the measurements.
 *
 * `preFilterIds` stays a separate `IN` list because it is the query plan's
 * hard filter, not an ownership check.
 */
export function findSearchNeighbors(
  scope: Scope,
  queryVec: Float32Array,
  k: number,
  preFilterIds?: Set<string>,
): { contactId: string; distance: number }[] {
  if (preFilterIds?.size === 0 || !Number.isFinite(k) || k < 1) return [];
  const buf = Buffer.from(new Float32Array(queryVec).buffer);
  const hardFilter = preFilterIds
    ? "AND c.id IN (SELECT value FROM json_each(?))"
    : "";
  const params = preFilterIds
    ? [
        buf,
        scope.ownerId,
        JSON.stringify([...preFilterIds]),
        Math.min(Math.floor(k), 500),
      ]
    : [buf, scope.ownerId, Math.min(Math.floor(k), 500)];
  return sqlite
    .prepare(
      `
    SELECT contactId, distance FROM search_embeddings
    WHERE embedding MATCH ?
      AND ownerId = ?
      AND contactId IN (SELECT c.id FROM contacts c WHERE ${ACTIVE_CONTACT_SQL} ${hardFilter})
      AND k = ? ORDER BY distance
  `,
    )
    .all(...params) as { contactId: string; distance: number }[];
}

/**
 * How many of one owner's contacts have a search vector.
 *
 * `ownerId` is the partition key, so this counts one partition rather than
 * the table. The vector channel uses it to decide whether to run at all, and
 * an owner who has never been indexed must see zero rather than the
 * instance's total.
 */
export function getSearchEmbeddingCount(scope: Scope): number {
  const row = sqlite
    .prepare("SELECT COUNT(*) as c FROM search_embeddings WHERE ownerId = ?")
    .get(scope.ownerId) as { c: number };
  return row.c;
}

// =============================================================================
// Embedding-store migration
// =============================================================================

/**
 * Bring the vector store in line with the configured embeddings capability.
 *
 * Called at startup and whenever the embeddings capability changes. When the
 * configured model differs from what the table was built with, the vec0 table
 * is recreated at the new dimension and every contact is re-embedded.
 *
 * Returns the number of contacts re-embedded (0 when nothing changed).
 */
export async function ensureEmbeddingStore(): Promise<number> {
  const resolved = resolveEmbeddings();

  // A provider model's dimension is unknown until probed.
  let dimension = resolved.dimension;
  if (dimension === null && resolved.providerId && resolved.model) {
    dimension = await probeDimension(resolved.providerId, resolved.model);
    if (dimension === null) {
      log.warn(
        "LocalEmbeddings",
        `Could not determine dimension for ${resolved.signature}; keeping the existing vector store`,
      );
      return 0;
    }
  }
  if (dimension === null) return 0;

  const state = getEmbeddingsState();
  const changed =
    !state ||
    state.signature !== resolved.signature ||
    state.dimension !== dimension;
  if (!changed) return 0;

  if (state || dimension !== BUILTIN_DIMENSION) {
    log.info(
      "LocalEmbeddings",
      `Embeddings changed (${state?.signature ?? "unversioned"} → ${resolved.signature}); rebuilding vector store`,
    );
    rebuildSearchEmbeddingTable(dimension);
  }
  setEmbeddingsState({ signature: resolved.signature, dimension });
  return backfillSearchEmbeddings();
}

// =============================================================================
// Backfill: Embed All Contacts
// =============================================================================

/**
 * Owners take turns in rounds of this many contacts.
 *
 * A single instance-wide pass finished the first owner completely before it
 * started the second, so on a busy instance a new account's search stayed
 * empty until every older account was done. One round each, in turn, gives
 * every account results in about the same time.
 */
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

/** The prepared statements one backfill round needs. */
function backfillStatements() {
  return {
    missing: sqlite.prepare(
      `
    SELECT c.id, c.name, c.company, c.role, c.location, c.industry,
           c.headline, c.about, c.preferences, c.searchExpansion
    FROM contacts c
    WHERE c.ownerId = ?
      AND ${ACTIVE_CONTACT_SQL}
      AND c.id NOT IN (SELECT contactId FROM search_embeddings)
  `,
    ),
    tags: sqlite.prepare("SELECT tag FROM contact_tags WHERE contactId = ?"),
    interests: sqlite.prepare(
      "SELECT interest FROM contact_interests WHERE contactId = ?",
    ),
    remove: sqlite.prepare(
      // Every id came out of the scoped query above.
      // tenant-lint: allow owner-checked by caller
      "DELETE FROM search_embeddings WHERE contactId = ?",
    ),
    insert: sqlite.prepare(
      `INSERT INTO search_embeddings (contactId, ownerId, embedding)
     SELECT ?, c.ownerId, ? FROM contacts c WHERE c.id = ?`,
    ),
  };
}

/**
 * Embed one account's round.
 *
 * `aborted` is true when the configured embeddings capability changed while a
 * batch was in flight. The vector store is about to be rebuilt at the new
 * dimension, so the whole backfill stops rather than writing rows in two
 * shapes.
 */
async function embedSearchRound(
  rows: SearchTextRow[],
  stmts: ReturnType<typeof backfillStatements>,
): Promise<{ embedded: number; aborted: boolean }> {
  let embedded = 0;

  for (let i = 0; i < rows.length; i += BACKFILL_BATCH_SIZE) {
    const batch = rows.slice(i, i + BACKFILL_BATCH_SIZE);

    // Build text for each contact
    const texts = batch.map((c) => {
      const tags = (stmts.tags.all(c.id) as { tag: string }[]).map(
        (t) => t.tag,
      );
      const interests = (
        stmts.interests.all(c.id) as { interest: string }[]
      ).map((t) => t.interest);
      return contactToSearchText(c, tags, interests);
    });

    const signature = resolveEmbeddings().signature;
    const vectors = await embedBatch(texts);
    if (signature !== resolveEmbeddings().signature) {
      return { embedded, aborted: true };
    }

    // Store in transaction for speed
    if (vectors.length !== batch.length) {
      throw new AppError(
        `Embedding backend returned ${vectors.length} vectors for ${batch.length} contacts — refusing to write a partial index`,
      );
    }

    const txn = sqlite.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec || currentSearchText(batch[j].id) !== texts[j]) continue;
        const buf = Buffer.from(vec.buffer.slice(0));
        stmts.remove.run(batch[j].id);
        // The third bind is the contact the owner is read from.
        stmts.insert.run(batch[j].id, buf, batch[j].id);
        embedded++;
      }
    });
    txn();
  }

  return { embedded, aborted: false };
}

/**
 * Generate and store search embeddings for every contact that has none.
 *
 * One account at a time, in rounds, each round inside that account's context.
 * The embedding model is local, so there is no bill to attribute, but the
 * context is what keeps a future provider-backed model from charging the
 * primary admin for everybody's corpus.
 *
 * ~2s for 960 contacts on Apple Silicon.
 */
export async function backfillSearchEmbeddings(): Promise<number> {
  if (!isSearchEmbeddingReady()) {
    log.warn("LocalEmbeddings", "Cannot backfill: no embedding backend ready");
    return 0;
  }

  const t0 = Date.now();
  const stmts = backfillStatements();

  // One scoped query per account, up front. The whole set is the same size the
  // instance-wide query returned, and knowing each account's queue is what
  // makes the round-robin below possible.
  const queues: { ownerId: string; rows: SearchTextRow[] }[] = [];
  for (const ownerId of ownersWithContacts()) {
    const rows = stmts.missing.all(ownerId) as SearchTextRow[];
    if (rows.length > 0) queues.push({ ownerId, rows });
  }

  if (queues.length === 0) {
    log.debug("LocalEmbeddings", "All contacts already have search embeddings");
    return 0;
  }

  let embedded = 0;
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const queue of queues) {
      if (queue.rows.length === 0) continue;
      const round = queue.rows.splice(0, OWNER_ROUND_SIZE);
      const result = await runWithContext(
        {
          requestId: `job-search-backfill-${queue.ownerId.slice(0, 8)}`,
          principal: null,
          scope: scopeForOwnerId(queue.ownerId),
        },
        () => embedSearchRound(round, stmts),
      );
      embedded += result.embedded;
      if (result.aborted) return embedded;
      if (queue.rows.length > 0) remaining = true;
    }
  }

  log.info(
    "LocalEmbeddings",
    `Backfilled ${embedded} search embeddings for ${queues.length} account(s) in ${Date.now() - t0}ms`,
  );
  return embedded;
}

/**
 * Generate and store a search embedding for a single contact.
 * Called on contact create/update.
 */
export async function embedContact(contactId: string): Promise<void> {
  if (!isSearchEmbeddingReady()) return;

  const row = sqlite
    .prepare(
      // tenant-lint: allow owner-checked by caller
      `
    SELECT id, name, company, role, location, industry, headline, about, preferences, searchExpansion
    FROM contacts c WHERE c.id = ? AND ${ACTIVE_CONTACT_SQL}
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
  const signature = resolveEmbeddings().signature;
  const vec = await embedText(text);
  if (!vec) return;

  if (
    signature !== resolveEmbeddings().signature ||
    text !== currentSearchText(contactId)
  )
    return;
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

/** Read current source text after an asynchronous embedding call. */
function currentSearchText(contactId: string): string | null {
  const row = sqlite
    .prepare(
      // tenant-lint: allow owner-checked by caller
      `SELECT c.* FROM contacts c WHERE c.id = ? AND ${ACTIVE_CONTACT_SQL}`,
    )
    .get(contactId) as SearchTextRow | undefined;
  if (!row) return null;
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
  return contactToSearchText(row, tags, interests);
}
