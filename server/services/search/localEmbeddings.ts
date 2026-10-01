import { randomUUID } from "node:crypto";
import { PASSAGE_VERSION, passageVectorDdl } from "./passageIndex.ts";
import {
  passageSnapshot,
  type PassageSnapshot,
  type SearchPassage,
} from "./passages.ts";
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
// The model produces 384-dimensional L2-normalized vectors, stored as int8 in
// a separate `search_embeddings` vec0 table (`vectorScale.ts`). The dedupe
// engine continues using Gemini's 768-dim embeddings for higher-accuracy
// similarity.
// =============================================================================

import {
  refreshPlannerStats,
  sqlite,
  vecElementFor,
  vecTableDdl,
  VEC_ACTIVE_MATCH,
  VEC_METADATA_SQL,
} from "../../db.ts";
import {
  UNIT_SCALE,
  VECTOR_SCALE_KEY,
  quantize,
  scaleFor,
} from "./vectorScale.ts";
import { deleteSetting, getSetting, setSetting } from "../settingsService.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import { scopeForOwnerId, type Scope } from "../../tenancy/scope.ts";
import { runWithContext } from "../../tenancy/requestContext.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { isWorkerActive, runOnWorker } from "../../workers/cpuHost.ts";
import { unflatten } from "../../workers/protocol.ts";
import {
  resolveEmbeddings,
  embedWithProvider,
  mayEmbedContactsFor,
  probeDimension,
  getEmbeddingsState,
  setEmbeddingsState,
  BUILTIN_DIMENSION,
} from "../../ai/embeddings.ts";
// Type-only import — fully erased at compile time, so the runtime module
// graph still loads @huggingface/transformers lazily via dynamic import.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import {
  EMBEDDING_MODEL_ID,
  configureModelLibrary,
  describeModelLoadError,
} from "./modelFiles.ts";
import type { CompiledFacets } from "./facetSql.ts";

// =============================================================================
// Types & State
// =============================================================================

/**
 * The pipeline on THIS thread, used only when the worker could not start.
 *
 * Normally null for the life of the process: the model lives on the CPU
 * worker and this thread never loads it.
 */
let fallbackExtractor: FeatureExtractionPipeline | null = null;
let modelReady = false;
let initPromise: Promise<void> | null = null;

const MODEL_ID = EMBEDDING_MODEL_ID;
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
      // One text through the real path, which loads the model wherever the
      // model lives: on the worker normally, on this thread when the worker
      // could not start. Doing it at boot rather than on the first search
      // keeps the two-and-a-half second cold load off somebody's query.
      const [probe] = await embedTexts(["contrack"]);
      if (!probe || probe.length !== BUILTIN_DIMENSION) {
        throw new Error(
          `The embedding model returned ${probe?.length ?? 0} dimensions, expected ${BUILTIN_DIMENSION}`,
        );
      }
      modelReady = true;
      log.info(
        "LocalEmbeddings",
        `Model ${MODEL_ID} ready in ${Date.now() - t0}ms (${BUILTIN_DIMENSION}-dim, q8, ` +
          `${isWorkerActive() ? "CPU worker" : "in process"})`,
      );
    } catch (err: unknown) {
      log.warn(
        "LocalEmbeddings",
        `Failed to load local embedding model: ${describeModelLoadError(getErrorMessage(err), MODEL_ID)}`,
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
export async function embedText(
  text: string,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  const [vector] = await embedTexts([text], signal);
  return vector ?? null;
}

/**
 * Embed one or more texts using the configured embeddings capability.
 *
 * Routes to the pinned provider model when the embeddings capability is
 * configured, otherwise to the bundled local model. Returns an empty array
 * when no backend is available (search degrades to FTS-only).
 */
async function embedTexts(
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  signal?.throwIfAborted();
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

  // No `modelReady` gate. This function is what decides whether the model
  // works: `initLocalEmbeddings` calls it once at boot with a probe text and
  // sets the flag from the answer. Gating on the flag here would mean the
  // probe could never succeed.
  //
  // The model runs on the CPU worker. Running it here held the event loop for
  // 3.1 of the 3.3 seconds a 2,000-contact backfill took, in bursts of up to
  // 129 ms, and on a shared instance that is every other account's requests
  // waiting behind one account's index being built.
  //
  // The query path goes the same way, even though one text is only 0.8 ms.
  // Measured, the round trip costs 0.44 ms against 0.39 ms in process, and
  // routing everything through one place means one copy of the model in
  // memory rather than two.
  const vectors = await runOnWorker(
    { kind: "embed", texts, batchSize: BACKFILL_BATCH_SIZE },
    () => embedTextsInProcess(texts),
    (result) => {
      if (result.kind !== "embed") throw new AppError("Wrong worker result");
      // Copied out of the transferred buffer. `subarray` is a view, and the
      // caller keeps these vectors past the life of the message.
      return unflatten(result).map((v) => new Float32Array(v));
    },
    undefined,
    signal,
  );

  for (const vec of vectors) {
    // Guards against a silent local-model swap by a contributor.
    if (vec.length !== BUILTIN_DIMENSION) {
      throw new AppError(
        `Expected ${BUILTIN_DIMENSION}-dim vector from the built-in model, got ${vec.length}`,
      );
    }
  }
  return vectors;
}

/**
 * The model, on this thread.
 *
 * Only reached when the worker could not start. It keeps a second copy of the
 * model in memory, which is the price of the product still working on a Node
 * build where `worker_threads` is unavailable.
 */
async function embedTextsInProcess(texts: string[]): Promise<Float32Array[]> {
  if (!fallbackExtractor) {
    const { pipeline, env: hfEnv } = await import("@huggingface/transformers");
    configureModelLibrary(hfEnv);
    fallbackExtractor = await pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
  }
  const output = await fallbackExtractor(texts, {
    pooling: "mean",
    normalize: true,
  });
  return (output.tolist() as number[][]).map((v) => new Float32Array(v));
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
  sqlite.transaction(() => {
    // Both tables are derived data for every owner when the model changes.
    sqlite.exec(
      // tenant-lint: allow instance sweep
      `DELETE FROM search_passages; DELETE FROM search_passage_state; DROP TABLE IF EXISTS search_passage_vectors`,
    );
    sqlite.exec(passageVectorDdl(dimension));
    sqlite.exec(`DROP TABLE IF EXISTS search_embeddings`);
    // The DDL comes from db.ts so a model change cannot silently recreate the
    // table without its partition key, which would make every scoped KNN in
    // Phase 2 return nothing. A unit test pins the two call sites equal.
    sqlite.exec(
      vecTableDdl(
        "search_embeddings",
        dimension,
        vecElementFor("search_embeddings"),
      ),
    );
    // A new model has its own range of components, so the first write after
    // this sets a new scale.
    deleteSetting(VECTOR_SCALE_KEY);
    try {
      sqlite.exec("DELETE FROM search_index_queue");
    } catch {
      /* table may not exist yet */
    }
  })();
  log.info(
    "LocalEmbeddings",
    `Rebuilt search_embeddings at ${dimension} dimensions (re-embed required)`,
  );
}

// =============================================================================
// Storage: search_embeddings Table Operations
// =============================================================================

/** The table's int8 scale, or null before the first vector is written. */
export function searchVectorScale(): number | null {
  const scale = getSetting<number>(VECTOR_SCALE_KEY);
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0
    ? scale
    : null;
}

/** True when the table holds at least one vector, for any owner. */
function hasSearchVectors(): boolean {
  // The scale is one per table, so this looks across owners on purpose.
  // tenant-lint: allow instance sweep
  return !!sqlite.prepare("SELECT 1 FROM search_embeddings LIMIT 1").get();
}

/**
 * The scale to write `vectors` at.
 *
 * The table's own scale once it has one. The first write to an empty table
 * sets it from the vectors that write carries: the first backfill batch, or
 * every vector of an evaluation corpus. An emptied table starts over.
 */
function writeScale(vectors: Float32Array[]): number {
  const stored = searchVectorScale();
  if (stored !== null && hasSearchVectors()) return stored;
  const scale = scaleFor(vectors);
  // Only zero vectors: nothing to learn a scale from, and zero is zero at
  // any scale.
  if (scale === null) return stored ?? UNIT_SCALE;
  setSetting(VECTOR_SCALE_KEY, scale);
  return scale;
}

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
  sqlite
    // tenant-lint: allow owner-checked by caller
    .prepare("DELETE FROM search_embeddings WHERE contactId = ?")
    .run(contactId);
  // The owner and the three status columns all come out of the contact row in
  // this one statement, so a vector cannot disagree with its contact about
  // who owns it or whether it is archived. A contact that is gone matches
  // nothing and writes nothing, which is the orphan case handled by omission.
  sqlite
    .prepare(
      `INSERT INTO search_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
       SELECT c.id, c.ownerId, ${VEC_METADATA_SQL}, vec_int8(?)
         FROM contacts c WHERE c.id = ? AND c.ownerId IS NOT NULL`,
    )
    .run(buf, contactId);
});

export function upsertSearchEmbedding(
  contactId: string,
  embedding: Float32Array,
): void {
  upsertSearchEmbeddings([{ contactId, embedding }]);
}

/**
 * Upsert several contacts' vectors in one transaction, at one scale.
 *
 * Into an empty table, the scale comes from all of them together. The
 * evaluation gates write their whole corpus this way, so its scale is the
 * one the boot migration would compute from the same vectors.
 */
export function upsertSearchEmbeddings(
  rows: { contactId: string; embedding: Float32Array }[],
): void {
  if (!rows.length) return;
  const scale = writeScale(rows.map((row) => row.embedding));
  // `quantize` writes a new buffer, so nothing here borrows the memory
  // Transformers.js handed back.
  sqlite.transaction(() => {
    for (const row of rows)
      _upsertTxn(row.contactId, quantize(row.embedding, scale));
  })();
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
 * The three status predicates are vec0 metadata columns, so sqlite-vec drops
 * a ghost or an archived contact while it is choosing the k nearest rather
 * than after. They replaced `contactId IN (SELECT c.id FROM contacts c ...)`,
 * which gave the same answers but made SQLite materialize a list of every
 * active contact the account has on every single search. Measured at k = 50:
 * 0.83 ms to 0.10 ms on 1,000 contacts, 8.16 ms to 0.36 ms on 10,000, and
 * 43.68 ms to 1.48 ms on 50,000, for the same fifty contacts in the same
 * order.
 *
 * `preFilterIds` stays a separate `IN` list because it is the query plan's
 * hard filter, not an ownership check. It is small by nature — a list, a tag,
 * a set of ids the planner already chose — so materializing it is cheap.
 */
export function findSearchNeighbors(
  scope: Scope,
  queryVec: Float32Array,
  k: number,
  preFilterIds?: Set<string>,
  facets?: CompiledFacets | null,
): { contactId: string; distance: number }[] {
  if (preFilterIds?.size === 0 || !Number.isFinite(k) || k < 1) return [];
  // The query goes through the table's scale, so its distances compare with
  // the stored vectors'. Without one, every stored vector is zero.
  const buf = quantize(queryVec, searchVectorScale() ?? UNIT_SCALE);
  const selectors: string[] = [];
  if (preFilterIds) selectors.push("SELECT value FROM json_each(?)");
  // The facets run inside the KNN, before `k`, so a contact the facets keep
  // is never lost to closer neighbours they drop.
  if (facets)
    selectors.push(
      `SELECT c.id FROM contacts c WHERE c.ownerId = ? AND (${facets.sql})`,
    );
  // vec0 accepts one rowid IN constraint. Intersect both sets inside it,
  // or a query with a planner filter and a facet loses its vector channel.
  const candidateFilter = selectors.length
    ? `AND contactId IN (${selectors.join(" INTERSECT ")})`
    : "";
  const params = [
    buf,
    scope.ownerId,
    ...(preFilterIds ? [JSON.stringify([...preFilterIds])] : []),
    ...(facets ? [scope.ownerId, ...facets.params] : []),
    Math.min(Math.floor(k), 500),
  ];
  return sqlite
    .prepare(
      `
    SELECT contactId, distance FROM search_embeddings
    WHERE embedding MATCH vec_int8(?)
      AND ownerId = ?
      AND ${VEC_ACTIVE_MATCH}
      ${candidateFilter}
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

/**
 * Read passage vectors in the same space as contact vectors and the query.
 *
 * `CROSS JOIN` fixes the order of the join: the nearest-neighbour search is
 * the outer loop and runs once, and each of its rows looks up its passage.
 * Left to choose, SQLite plans from the row counts at the last ANALYZE. After
 * a bulk index those say "2 passages" for a table of twenty thousand, and it
 * put `search_passages` first, which ran this search once for every passage:
 * 145 seconds instead of 60 milliseconds (`refreshPlannerStats` keeps the
 * counts fresh too, but a plan that cannot go wrong does not need them).
 */
export function findPassageNeighbors(
  scope: Scope,
  query: Float32Array,
  ids?: Set<string> | null,
  facets?: CompiledFacets | null,
): (SearchPassage & { distance: number })[] {
  if (ids?.size === 0) return [];
  const filter =
    ids || facets
      ? `AND passageId IN (
    SELECT p.id FROM search_passages p JOIN contacts c ON c.id = p.contactId
    WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
      ${ids ? "AND c.id IN (SELECT value FROM json_each(?))" : ""}
      ${facets ? `AND (${facets.sql})` : ""})`
      : "";
  return sqlite
    .prepare(
      `
    SELECT p.*, n.distance FROM (
      SELECT passageId, distance FROM search_passage_vectors
      WHERE embedding MATCH vec_int8(?) AND ownerId = ? AND ${VEC_ACTIVE_MATCH}
        ${filter} AND k = 300 ORDER BY distance
    ) n CROSS JOIN search_passages p ON p.id = n.passageId
    WHERE p.ownerId = ? ORDER BY n.distance, p.id
  `,
    )
    .all(
      quantize(query, searchVectorScale() ?? UNIT_SCALE),
      scope.ownerId,
      ...(ids || facets ? [scope.ownerId] : []),
      ...(ids ? [JSON.stringify([...ids])] : []),
      ...(facets?.params ?? []),
      scope.ownerId,
    ) as (SearchPassage & { distance: number })[];
}

/** Bounded batches prevent one long profile from occupying a worker request. */
async function embedPassageSnapshots(
  snapshots: (PassageSnapshot | null)[],
): Promise<Float32Array[][]> {
  const passages = snapshots.flatMap((snapshot) => snapshot?.passages ?? []);
  const vectors: Float32Array[] = [];
  for (let i = 0; i < passages.length; i += BACKFILL_BATCH_SIZE) {
    const texts = passages
      .slice(i, i + BACKFILL_BATCH_SIZE)
      .map((passage) => `${passage.context.slice(0, 200)} | ${passage.text}`);
    const batch = await embedBatch(texts);
    if (
      batch.length !== texts.length ||
      batch.some((vector) => !vector || !vector.every(Number.isFinite))
    ) {
      throw new AppError(
        "Embedding backend returned incomplete passage vectors",
      );
    }
    vectors.push(...(batch as Float32Array[]));
  }
  let offset = 0;
  return snapshots.map((snapshot) => {
    const count = snapshot?.passages.length ?? 0;
    const result = vectors.slice(offset, offset + count);
    offset += count;
    return result;
  });
}

/** The caller writes contact and passage vectors in the same transaction. */
function writePassages(
  contactId: string,
  snapshot: PassageSnapshot,
  vectors: Float32Array[],
  signature: string,
  scale: number,
): void {
  sqlite
    .prepare("DELETE FROM search_passages WHERE contactId = ? AND ownerId = ?")
    .run(contactId, snapshot.ownerId);
  const insert = sqlite.prepare(`INSERT INTO search_passages
    (id, contactId, ownerId, field, sourceId, sourceHash, context, startOffset, endOffset, text)
    VALUES (@id, @contactId, @ownerId, @field, @sourceId, @sourceHash, @context, @startOffset, @endOffset, @text)`);
  const insertVector =
    sqlite.prepare(`INSERT INTO search_passage_vectors (passageId, ownerId, isGhost, isArchived, active, embedding)
    SELECT ?, c.ownerId, ${VEC_METADATA_SQL}, vec_int8(?) FROM contacts c WHERE c.id = ? AND c.ownerId = ?`);
  snapshot.passages.forEach((passage, index) => {
    insert.run(passage);
    insertVector.run(
      passage.id,
      quantize(vectors[index], scale),
      contactId,
      snapshot.ownerId,
    );
  });
  sqlite
    .prepare(
      `INSERT INTO search_passage_state (contactId, ownerId, representationVersion, fingerprint, signature)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(contactId) DO UPDATE SET ownerId = excluded.ownerId,
      representationVersion = excluded.representationVersion, fingerprint = excluded.fingerprint,
      signature = excluded.signature, indexedAt = CURRENT_TIMESTAMP`,
    )
    .run(
      contactId,
      snapshot.ownerId,
      PASSAGE_VERSION,
      snapshot.fingerprint,
      signature,
    );
  sqlite
    .prepare(
      `INSERT INTO search_revision (ownerId, revision) VALUES (?, 1)
    ON CONFLICT(ownerId) DO UPDATE SET revision = search_revision.revision + 1`,
    )
    .run(snapshot.ownerId);
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
  if (
    dimension === null ||
    resolveEmbeddings().signature !== resolved.signature
  )
    return 0;

  const state = getEmbeddingsState();
  const changed =
    !state ||
    state.signature !== resolved.signature ||
    state.dimension !== dimension ||
    state.representationVersion !== PASSAGE_VERSION;
  if (!changed) return backfillSearchEmbeddings();

  log.info(
    "LocalEmbeddings",
    `Embeddings changed (${state?.signature ?? "unversioned"} → ${resolved.signature}); rebuilding vector store`,
  );
  // Missing metadata cannot prove the physical vector width or model identity.
  rebuildSearchEmbeddingTable(dimension);
  setEmbeddingsState({
    signature: resolved.signature,
    dimension,
    representationVersion: PASSAGE_VERSION,
    generation: randomUUID(),
  });
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

// TODO(v2.1): Compare newer embedding models on held-out precision, recall and CPU latency before changing the default.
// The representation version and model signature let the index rebuild without replacing contact data.

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
    WHERE c.ownerId = ? AND c.id > ?
      AND ${ACTIVE_CONTACT_SQL}
      AND (c.id NOT IN (SELECT contactId FROM search_embeddings)
        OR c.id NOT IN (SELECT contactId FROM search_passage_state WHERE representationVersion = ${PASSAGE_VERSION}))
    ORDER BY c.id LIMIT ?
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
    queueRemove: sqlite.prepare(
      "DELETE FROM search_index_queue WHERE contactId = ?",
    ),
    insert: sqlite.prepare(
      `INSERT INTO search_embeddings (contactId, ownerId, isGhost, isArchived, active, embedding)
     SELECT c.id, c.ownerId, ${VEC_METADATA_SQL}, vec_int8(?) FROM contacts c WHERE c.id = ?`,
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
    const generation = getEmbeddingsState()?.generation;
    const snapshots = batch.map((row) => passageSnapshot(row.id));
    const vectors = await embedBatch(texts);
    const passageVectors = await embedPassageSnapshots(snapshots);
    if (
      signature !== resolveEmbeddings().signature ||
      generation !== getEmbeddingsState()?.generation
    ) {
      return { embedded, aborted: true };
    }

    // Store in transaction for speed
    if (vectors.length !== batch.length) {
      throw new AppError(
        `Embedding backend returned ${vectors.length} vectors for ${batch.length} contacts — refusing to write a partial index`,
      );
    }

    const scale = writeScale([
      ...vectors.filter((vec): vec is Float32Array => !!vec),
      ...passageVectors.flat(),
    ]);
    const txn = sqlite.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec || currentSearchText(batch[j].id) !== texts[j]) continue;
        const snapshot = snapshots[j];
        if (
          !snapshot ||
          passageSnapshot(batch[j].id)?.fingerprint !== snapshot.fingerprint
        )
          continue;
        const buf = quantize(vec, scale);
        stmts.remove.run(batch[j].id);
        // One bind for the vector and one for the contact the owner and the
        // status columns are read from.
        stmts.insert.run(buf, batch[j].id);
        writePassages(
          batch[j].id,
          snapshot,
          passageVectors[j],
          signature,
          scale,
        );
        stmts.queueRemove.run(batch[j].id);
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
 */
let backfillTail: Promise<number> = Promise.resolve(0);
let backfillRunning = false;
export function isSearchBackfillRunning(): boolean {
  return backfillRunning;
}

/** Serialize rebuilds so two startup or settings requests cannot index the same batch. */
export function backfillSearchEmbeddings(): Promise<number> {
  backfillTail = backfillTail
    .catch(() => 0)
    .then(async () => {
      backfillRunning = true;
      try {
        return await runBackfill();
      } finally {
        backfillRunning = false;
      }
    });
  return backfillTail;
}

async function runBackfill(): Promise<number> {
  if (!isSearchEmbeddingReady()) {
    log.warn("LocalEmbeddings", "Cannot backfill: no embedding backend ready");
    return 0;
  }

  const t0 = Date.now();
  const stmts = backfillStatements();

  // Read bounded pages so a rebuild never retains every owner's full biographies.
  const queues = ownersWithContacts().map((ownerId) => ({
    ownerId,
    cursor: "",
    done: false,
  }));
  const enqueue = sqlite.prepare(
    `INSERT OR IGNORE INTO search_index_queue (contactId, ownerId) VALUES (?, ?)`,
  );

  let embedded = 0;
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const queue of queues) {
      if (queue.done) continue;
      // Read each round, because the owner can turn AI off while a provider
      // backfill runs.
      if (!mayEmbedContactsFor(queue.ownerId)) {
        queue.done = true;
        continue;
      }
      const round = stmts.missing.all(
        queue.ownerId,
        queue.cursor,
        OWNER_ROUND_SIZE,
      ) as SearchTextRow[];
      if (!round.length) {
        queue.done = true;
        continue;
      }
      queue.cursor = round[round.length - 1].id;
      sqlite.transaction(() => {
        for (const row of round) enqueue.run(row.id, queue.ownerId);
      })();
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
      remaining = true;
    }
  }

  // A backfill writes thousands of vectors and passages, so the planner's row
  // counts from boot can be out of date.
  if (embedded > 0) refreshPlannerStats();
  log.info(
    "LocalEmbeddings",
    `Backfilled ${embedded} search embeddings for ${queues.length} account(s) in ${Date.now() - t0}ms`,
  );
  return embedded;
}

export interface EmbedContactResult {
  status: "indexed" | "outdated" | "skipped";
  reason?: string;
}

/**
 * Generate and store a search embedding for a single contact.
 * Called on contact create/update or from indexQueue.
 */
export async function embedContact(
  contactId: string,
): Promise<EmbedContactResult> {
  if (!isSearchEmbeddingReady()) {
    return { status: "skipped", reason: "not_ready" };
  }

  const row = sqlite
    .prepare(
      // tenant-lint: allow owner-checked by caller
      `
    SELECT id, ownerId, name, company, role, location, industry, headline, about, preferences, searchExpansion
    FROM contacts c WHERE c.id = ? AND ${ACTIVE_CONTACT_SQL}
  `,
    )
    .get(contactId) as (SearchTextRow & { ownerId: string }) | undefined;

  if (!row) {
    return { status: "skipped", reason: "inactive_or_deleted" };
  }
  if (!mayEmbedContactsFor(row.ownerId)) {
    return { status: "skipped", reason: "ai_off" };
  }

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
  const generation = getEmbeddingsState()?.generation;
  const snapshot = passageSnapshot(contactId);
  if (!snapshot) return { status: "skipped", reason: "inactive_or_deleted" };
  const vec = await embedText(text);
  const [passageVectors] = await embedPassageSnapshots([snapshot]);
  if (!vec) {
    throw new Error(
      `Failed to generate embedding vector for contact ${contactId}`,
    );
  }

  if (
    signature !== resolveEmbeddings().signature ||
    generation !== getEmbeddingsState()?.generation
  ) {
    return { status: "outdated", reason: "signature_changed" };
  }

  if (
    text !== currentSearchText(contactId) ||
    passageSnapshot(contactId)?.fingerprint !== snapshot.fingerprint
  ) {
    return { status: "outdated", reason: "contact_edited" };
  }

  sqlite.transaction(() => {
    const scale = writeScale([vec, ...passageVectors]);
    _upsertTxn(contactId, quantize(vec, scale));
    writePassages(contactId, snapshot, passageVectors, signature, scale);
  })();
  return { status: "indexed" };
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
 * This compact vector complements the full source passages.
 * Expansion terms help retrieval but never count as verified evidence.
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

/**
 * The text a contact's search vector embeds, as the contact reads now.
 *
 * Also read by the evaluation recorders, which embed the same text.
 */
export function currentSearchText(contactId: string): string | null {
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
