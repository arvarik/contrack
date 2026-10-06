// The embedder. Search and dedupe turn text into vectors through one interface,
// `Embedder`, and never ask which model is behind it:
//
// - `localEmbedder(model)`: a Transformers.js model on the CPU worker
//   (`server/workers/cpuHost.ts`), or on this thread when the worker never
//   started. No key, no network, no cost. `builtinEmbedder` is the bundled
//   Xenova/all-MiniLM-L6-v2.
// - a provider model through `AIProvider.embed`: Gemini, OpenAI, or an
//   OpenAI-compatible endpoint such as Ollama.
//
// `currentEmbedder()` picks one from the embeddings capability
// (`resolveEmbeddings` in `embeddings.ts`) on every call, so a Settings change
// reaches the next text. `local` says whether text leaves this server.
//
// Both vector stores record the embedder they were built with: its `id` and
// width. A model whose vectors change needs a new `id`, and then both stores
// rebuild at the next boot or settings change. Every call says what its texts
// are for (a question, a document, or a text compared with its kind), which
// some models read: Gemini's task types, the e5 and nomic prefixes. An adapter
// that starts to read it needs a new `id` too.

// Type-only import — erased at compile time, so @huggingface/transformers
// still loads lazily, and on this thread only when the worker never started.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { isWorkerActive, runOnWorker } from "../workers/cpuHost.ts";
import { unflatten } from "../workers/protocol.ts";
import {
  configureModelLibrary,
  describeModelLoadError,
} from "../services/search/modelFiles.ts";
import {
  BUILTIN_DIMENSION,
  BUILTIN_MODEL_ID,
  builtinSignature,
  embedWithProvider,
  probeDimension,
  resolveEmbeddings,
} from "./embeddings.ts";
import { aiAllowedForUser } from "./instanceSwitch.ts";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

/**
 * What a text is for: a question to match, a document to be found, or a text
 * compared with others of its kind, as a duplicate check compares contacts.
 */
export type EmbedUse = "query" | "document" | "similarity";

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

// Local models

/** A local embedding model: what the worker loads, and how it reads text. */
export interface LocalModel {
  /**
   * The Transformers.js model id. Its q8 ONNX weights load from the model
   * folder or the cache, or download once (`modelFiles.ts`).
   */
  model: string;
  /** The vector width. */
  dimension: number;
  /** How the token vectors become one vector: their mean, or the first token's. */
  pooling: "mean" | "cls";
  /**
   * Text put before each input, by what it is for. A model such as e5 or bge
   * was trained with one, and ranks worse without it.
   */
  prefix?: Partial<Record<EmbedUse, string>>;
}

/** The bundled model. It embeds a question and a document the same way. */
export const BUILTIN_MODEL: LocalModel = {
  model: BUILTIN_MODEL_ID,
  dimension: BUILTIN_DIMENSION,
  pooling: "mean",
};

/** Texts per forward pass on the worker. */
const BATCH_SIZE = 64;

/** The local models that have loaded, by id. */
const readyModels = new Set<string>();

/** Loads in flight, by id, so that two callers share one. */
const loading = new Map<string, Promise<boolean>>();

/**
 * Pipelines on this thread, used only when the worker could not start. Normally
 * empty: the models live on the CPU worker.
 */
const fallbackExtractors = new Map<
  string,
  Promise<FeatureExtractionPipeline>
>();

/** One adapter per local model, with the card it was made from. */
const localEmbedders = new Map<string, { card: string; embedder: Embedder }>();

/** A card's settings as one string, to tell two cards for one model apart. */
function cardKey(local: LocalModel): string {
  const { query = "", document = "", similarity = "" } = local.prefix ?? {};
  return JSON.stringify([
    local.dimension,
    local.pooling,
    query,
    document,
    similarity,
  ]);
}

/**
 * The local model `local` on the CPU worker, ready once it has loaded
 * (`initLocalEmbedder`), with id `builtin/<model>`. One card per model: a
 * second card with other settings would share the id while its vectors differ,
 * so it throws.
 */
export function localEmbedder(local: LocalModel): Embedder {
  const known = localEmbedders.get(local.model);
  if (known) {
    if (known.card !== cardKey(local))
      throw new AppError(
        `Two local model cards name ${local.model} with different settings`,
      );
    return known.embedder;
  }
  const embedder: Embedder = {
    id: builtinSignature(local.model),
    local: true,
    ready: () => readyModels.has(local.model),
    dimension: async () => local.dimension,
    embed: (texts, use, signal) => {
      const prefix = local.prefix?.[use];
      return embedLocal(
        local,
        prefix ? texts.map((text) => prefix + text) : texts,
        signal,
      );
    },
  };
  localEmbedders.set(local.model, { card: cardKey(local), embedder });
  return embedder;
}

/** The bundled model, which search and dedupe use unless a provider's is pinned. */
export const builtinEmbedder = localEmbedder(BUILTIN_MODEL);

/**
 * Load a local model with one probe text, once. True when it is ready. A failed
 * load can be tried again from the start.
 */
export function initLocalEmbedder(local: LocalModel): Promise<boolean> {
  if (readyModels.has(local.model)) return Promise.resolve(true);
  let pending = loading.get(local.model);
  if (!pending) {
    pending = (async () => {
      try {
        const t0 = Date.now();
        // One text through the real path, at boot rather than on the first
        // search, so the cold load of about 2.5 s is not on somebody's query.
        const [probe] = await embedLocal(local, ["contrack"]);
        if (!probe) throw new Error("The embedding model returned no vector");
        readyModels.add(local.model);
        log.info(
          "LocalEmbeddings",
          `Model ${local.model} ready in ${Date.now() - t0}ms (${local.dimension}-dim, q8, ` +
            `${isWorkerActive() ? "CPU worker" : "in process"})`,
        );
        return true;
      } catch (err: unknown) {
        log.warn(
          "LocalEmbeddings",
          `Failed to load local embedding model: ${describeModelLoadError(getErrorMessage(err), local.model)}`,
        );
        return false;
      } finally {
        loading.delete(local.model);
      }
    })();
    loading.set(local.model, pending);
  }
  return pending;
}

/**
 * Load the bundled model at startup, whatever the capability names, so turning
 * AI off or choosing the built-in model again finds it loaded. Probing through
 * the capability would send the probe to a pinned provider instead.
 */
export function initBuiltinEmbedder(): Promise<boolean> {
  return initLocalEmbedder(BUILTIN_MODEL);
}

/**
 * A local model's vectors. No readiness gate: `initLocalEmbedder` calls this
 * with its probe to decide readiness, so a gate would never let it succeed.
 */
async function embedLocal(
  local: LocalModel,
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  signal?.throwIfAborted();
  if (texts.length === 0) return [];

  // The model runs on the CPU worker: on this thread it held the event loop for
  // 3.1 of the 3.3 seconds a 2,000-contact backfill took, in bursts of up to
  // 129 ms, and every other account's requests waited. Queries go the same way
  // (a round trip of 0.44 ms against 0.39 ms in process), so there is one copy
  // of the model in memory.
  const vectors = await runOnWorker(
    {
      kind: "embed",
      model: local.model,
      pooling: local.pooling,
      texts,
      batchSize: BATCH_SIZE,
    },
    () => embedInProcess(local, texts),
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
      `${local.model} returned ${vectors.length} vectors for ${texts.length} texts`,
    );
  }
  for (const vec of vectors) {
    // Guards against a model that is not as wide as its card says.
    if (vec.length !== local.dimension) {
      throw new AppError(
        `Expected ${local.dimension}-dim vector from ${local.model}, got ${vec.length}`,
      );
    }
  }
  return vectors;
}

/**
 * The model on this thread, only when the worker could not start (a Node build
 * without `worker_threads`). It keeps a second copy of the model in memory.
 */
async function embedInProcess(
  local: LocalModel,
  texts: string[],
): Promise<Float32Array[]> {
  let extractor = fallbackExtractors.get(local.model);
  if (!extractor) {
    extractor = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      configureModelLibrary(env);
      return pipeline("feature-extraction", local.model, {
        dtype: "q8",
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      });
    })();
    fallbackExtractors.set(local.model, extractor);
    extractor.catch(() => fallbackExtractors.delete(local.model));
  }
  const output = await (
    await extractor
  )(texts, {
    pooling: local.pooling,
    normalize: true,
  });
  return (output.tolist() as number[][]).map((v) => new Float32Array(v));
}

// Provider models

/**
 * Providers whose `embed` reads the use. Gemini makes each one a task type, so
 * its id carries `+tasks`.
 */
const PROVIDERS_WITH_TASK_TYPES = new Set(["gemini"]);

/**
 * A provider's embedding model, through `AIProvider.embed`. Configured is
 * ready: a provider that cannot answer fails the call, and the caller keeps
 * keyword search. `embedWithProvider` checks the instance switch and refuses a
 * short batch. `known` is the width the capability cached, so only the first
 * call probes.
 */
function providerEmbedder(
  providerId: string,
  model: string,
  signature: string,
  known: number | null,
): Embedder {
  return {
    id: PROVIDERS_WITH_TASK_TYPES.has(providerId)
      ? `${signature}+tasks`
      : signature,
    local: false,
    ready: () => true,
    dimension: async () => known ?? probeDimension(providerId, model),
    async embed(texts, use, signal) {
      signal?.throwIfAborted();
      if (texts.length === 0) return [];
      const vectors = await embedWithProvider(providerId, model, texts, use);
      return vectors.map((v) => new Float32Array(v));
    },
  };
}

// The choice

/** An embedder that a test or a script put in place of the configured one. */
let replacement: Embedder | null = null;

/**
 * Use `embedder` instead of the configured one, for tests and scripts. Null
 * goes back. The stores rebuild for it at the next `ensureEmbeddingStore`, and
 * until then it must write vectors as wide as they are.
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
 * True when Contrack may embed this account's contacts now. A local model runs
 * on this server, so it embeds every account. A provider model sends contact
 * text out, so it embeds only for an account that allows AI: the admin picks
 * the model for everyone, and "Use AI for my account" still says no for one
 * person, who keeps keyword search (`embedQuery` skips their questions too).
 *
 * @param ownerId - The account that owns the contacts.
 * @param embedder - The embedder that would embed them. A backfill reads it
 *   once per round and asks about that one, so every call in the round uses the
 *   model this check allowed.
 */
export function mayEmbedContactsFor(
  ownerId: string,
  embedder = currentEmbedder(),
): boolean {
  return embedder.local || aiAllowedForUser(ownerId);
}

/** The code a guarded embedder refuses with. */
export const EMBEDDING_REFUSED = "EMBEDDING_REFUSED";

/**
 * `embedder`, refusing every call once `allowed()` says no. An account can turn
 * AI off while a run is under way, so every call checks again, and nothing more
 * of that account reaches a model that is not local. A refused call rejects
 * with `EMBEDDING_REFUSED` (`isRefused`), and the run stops for that account.
 */
export function whileAllowed(
  embedder: Embedder,
  allowed: () => boolean,
): Embedder {
  return {
    ...embedder,
    embed: (texts, use, signal) =>
      allowed()
        ? embedder.embed(texts, use, signal)
        : Promise.reject(
            new AppError("This account may no longer be embedded", 409, {
              code: EMBEDDING_REFUSED,
            }),
          ),
  };
}

/** The embedder a run uses for one account: `embedder`, while it may embed it. */
export function embedderFor(
  ownerId: string,
  embedder = currentEmbedder(),
): Embedder {
  return whileAllowed(embedder, () => mayEmbedContactsFor(ownerId, embedder));
}

/** True when `err` is a guarded embedder's refusal. */
export function isRefused(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === EMBEDDING_REFUSED;
}
