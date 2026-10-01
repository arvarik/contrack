// =============================================================================
// AI Layer — the embedder
// =============================================================================
// Search and dedupe turn text into vectors through one interface, `Embedder`,
// and never ask which model is behind it. Two adapters implement it:
//
//   - `builtinEmbedder`, the bundled Xenova/all-MiniLM-L6-v2. It runs on the
//     CPU worker (`server/workers/cpuHost.ts`), or on this thread when the
//     worker never started. No key, no network, no cost.
//   - a provider model, through `AIProvider.embed`: Gemini, OpenAI, or an
//     OpenAI-compatible endpoint such as Ollama.
//
// `currentEmbedder()` picks one from the embeddings capability
// (`resolveEmbeddings` in `embeddings.ts`) on every call, so a change in
// Settings or to the instance switch reaches the next text. A caller reads
// `local`, which says whether text leaves this server, and `ready()`.
//
// Both vector stores record the embedder they were built with: its `id` and
// its width (`dimension()`). A model whose vectors change needs a new `id`,
// and then both stores rebuild at the next boot or settings change.
//
// Every call says what its texts are for, a question or a document. Some
// models embed the two differently: Gemini's task types, the e5 and nomic
// prefixes. An adapter that starts to read it changes its vectors, so it
// needs a new `id` too.
// =============================================================================

// Type-only import — erased at compile time, so @huggingface/transformers
// still loads lazily, and on this thread only when the worker never started.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { isWorkerActive, runOnWorker } from "../workers/cpuHost.ts";
import { unflatten } from "../workers/protocol.ts";
import {
  EMBEDDING_MODEL_ID,
  configureModelLibrary,
  describeModelLoadError,
} from "../services/search/modelFiles.ts";
import {
  BUILTIN_DIMENSION,
  BUILTIN_SIGNATURE,
  embedWithProvider,
  probeDimension,
  resolveEmbeddings,
} from "./embeddings.ts";
import { aiAllowedForUser } from "./instanceSwitch.ts";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

/** What a text is for: a question to match, or a document to be found. */
export type EmbedUse = "query" | "document";

/** A model that turns text into vectors. */
export interface Embedder {
  /**
   * The model as the vector stores record it, `builtin/<model>` or
   * `<provider>/<model>`. A model whose vectors change needs a new one.
   */
  readonly id: string;
  /**
   * True when the model runs on this server, so no text leaves it and nothing
   * is billed. The privacy and cost rules read this, never the model's name.
   */
  readonly local: boolean;
  /** True when `embed` can answer now. */
  ready(): boolean;
  /**
   * The vector width, which both stores are built at. A provider model's
   * width is learned once, from a probe text (`probeDimension`), and is null
   * while that probe fails.
   */
  dimension(): Promise<number | null>;
  /**
   * One vector per text, in order. Throws when the model fails or answers
   * with another count, so no caller can write a short batch.
   */
  embed(
    texts: string[],
    use: EmbedUse,
    signal?: AbortSignal,
  ): Promise<Float32Array[]>;
}

// ---------------------------------------------------------------------------
// The built-in model
// ---------------------------------------------------------------------------

/** Texts per forward pass on the worker. */
const BATCH_SIZE = 64;

/**
 * The pipeline on THIS thread, used only when the worker could not start.
 *
 * Normally null for the life of the process: the model lives on the CPU
 * worker and this thread never loads it.
 */
let fallbackExtractor: FeatureExtractionPipeline | null = null;
let modelReady = false;
let initPromise: Promise<void> | null = null;

/** The bundled model. It embeds a question and a document the same way. */
export const builtinEmbedder: Embedder = {
  id: BUILTIN_SIGNATURE,
  local: true,
  ready: () => modelReady,
  dimension: async () => BUILTIN_DIMENSION,
  embed: (texts, _use, signal) => embedBuiltin(texts, signal),
};

/**
 * Load the bundled model. Called once on server startup.
 *
 * It loads the bundled model whatever the capability names. Until this
 * moved here it embedded its probe through the capability, so with a
 * provider model pinned it sent the probe to the provider, failed the width
 * check, and left the bundled model unloaded. Turning AI off for the
 * instance, or choosing the built-in model again, then left search with no
 * vectors until a restart.
 */
export async function initBuiltinEmbedder(): Promise<void> {
  if (modelReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const t0 = Date.now();
      // One text through the real path, which loads the model wherever the
      // model lives: on the worker normally, on this thread when the worker
      // could not start. Doing it at boot rather than on the first search
      // keeps the two-and-a-half second cold load off somebody's query.
      const [probe] = await embedBuiltin(["contrack"]);
      if (!probe) throw new Error("The embedding model returned no vector");
      modelReady = true;
      log.info(
        "LocalEmbeddings",
        `Model ${EMBEDDING_MODEL_ID} ready in ${Date.now() - t0}ms (${BUILTIN_DIMENSION}-dim, q8, ` +
          `${isWorkerActive() ? "CPU worker" : "in process"})`,
      );
    } catch (err: unknown) {
      log.warn(
        "LocalEmbeddings",
        `Failed to load local embedding model: ${describeModelLoadError(getErrorMessage(err), EMBEDDING_MODEL_ID)}`,
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

/**
 * The bundled model's vectors.
 *
 * No `modelReady` gate. This function is what decides whether the model
 * works: `initBuiltinEmbedder` calls it once at boot with a probe text and
 * sets the flag from the answer. Gating on the flag here would mean the probe
 * could never succeed.
 */
async function embedBuiltin(
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  signal?.throwIfAborted();
  if (texts.length === 0) return [];

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
    { kind: "embed", texts, batchSize: BATCH_SIZE },
    () => embedInProcess(texts),
    (result) => {
      if (result.kind !== "embed") throw new AppError("Wrong worker result");
      // Copied out of the transferred buffer. `subarray` is a view, and the
      // caller keeps these vectors past the life of the message.
      return unflatten(result).map((v) => new Float32Array(v));
    },
    undefined,
    signal,
  );

  if (vectors.length !== texts.length) {
    throw new AppError(
      `The built-in model returned ${vectors.length} vectors for ${texts.length} texts`,
    );
  }
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
async function embedInProcess(texts: string[]): Promise<Float32Array[]> {
  if (!fallbackExtractor) {
    const { pipeline, env: hfEnv } = await import("@huggingface/transformers");
    configureModelLibrary(hfEnv);
    fallbackExtractor = await pipeline(
      "feature-extraction",
      EMBEDDING_MODEL_ID,
      {
        dtype: "q8",
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      },
    );
  }
  const output = await fallbackExtractor(texts, {
    pooling: "mean",
    normalize: true,
  });
  return (output.tolist() as number[][]).map((v) => new Float32Array(v));
}

// ---------------------------------------------------------------------------
// Provider models
// ---------------------------------------------------------------------------

/**
 * A provider's embedding model, through `AIProvider.embed`.
 *
 * Configured is ready: a provider that cannot answer fails the call, and the
 * caller keeps its keyword search. `embedWithProvider` checks the instance
 * switch and refuses a short batch. `known` is the width the capability has
 * cached, so only the first call ever probes.
 */
function providerEmbedder(
  providerId: string,
  model: string,
  id: string,
  known: number | null,
): Embedder {
  return {
    id,
    local: false,
    ready: () => true,
    dimension: async () => known ?? probeDimension(providerId, model),
    async embed(texts, _use, signal) {
      signal?.throwIfAborted();
      if (texts.length === 0) return [];
      const vectors = await embedWithProvider(providerId, model, texts);
      return vectors.map((v) => new Float32Array(v));
    },
  };
}

// ---------------------------------------------------------------------------
// The choice
// ---------------------------------------------------------------------------

/** An embedder that a test or a script put in place of the configured one. */
let replacement: Embedder | null = null;

/**
 * Use `embedder` instead of the configured one. Null goes back.
 *
 * Tests and scripts only. The stores rebuild for it at the next
 * `ensureEmbeddingStore`, and until then it must write vectors as wide as
 * they are.
 */
export function setEmbedder(embedder: Embedder | null): void {
  replacement = embedder;
}

/** The embedder the embeddings capability names now. */
export function currentEmbedder(): Embedder {
  if (replacement) return replacement;
  const resolved = resolveEmbeddings();
  return resolved.kind === "provider" && resolved.providerId && resolved.model
    ? providerEmbedder(
        resolved.providerId,
        resolved.model,
        resolved.signature,
        resolved.dimension,
      )
    : builtinEmbedder;
}

/**
 * True when Contrack may embed this account's contacts now.
 *
 * A local model runs on this server, so it embeds every account. A provider
 * model sends each contact's text to the provider, so it embeds only the
 * contacts of an account that allows AI: the admin picks the model for
 * everyone, and "Use AI for this account" still says no for one person. That
 * account keeps keyword search, and its questions are not embedded either
 * (`embedQuery`).
 *
 * @param ownerId - The account that owns the contacts.
 * @param embedder - The embedder that would embed them. A backfill reads it
 *   once per round and asks about that one, so every call in the round uses
 *   the model this check allowed.
 */
export function mayEmbedContactsFor(
  ownerId: string,
  embedder = currentEmbedder(),
): boolean {
  return embedder.local || aiAllowedForUser(ownerId);
}
