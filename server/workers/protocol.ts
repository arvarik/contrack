// The worker job protocol, shared by the host on the main thread and the
// worker. Nothing here imports the database, the AI gateway or anything heavy:
// the worker loads this file first, and a module graph that reached
// `server/db.ts` would re-run every migration in a second thread.
//
// Four message kinds: start, progress, result, cancel. The host numbers each
// job, and every worker message carries its job's id, so two jobs in flight
// cannot be confused. Canceling happens on the host, which drops a job not yet
// sent; the worker ignores a cancel for a running job, because nothing in the
// product cancels one.
//
// Two job kinds: `embed` turns text into vectors, and `rerank` scores (query,
// profile) pairs with a cross-encoder. Both hold an onnxruntime session, so
// both run here, off the main thread. The dedupe passes stay on the main
// thread: a scan of 50,000 contacts spends about 500 ms in them, and shipping
// the corpus across the thread boundary and back would cost about 180 ms of
// structured clone on the main thread.

/** What a job asks the worker to do. */
export type WorkerJob = EmbedJob | RerankJob;

/**
 * Turn text into vectors. The worker holds the model; the main thread does
 * every read and write. On the main thread a backfill of 2,000 contacts blocked
 * the event loop for 3.1 of its 3.3 seconds, in bursts of up to 129 ms, and
 * every other account's requests waited.
 */
export interface EmbedJob {
  kind: "embed";
  /**
   * The Transformers.js model id, for example `Xenova/all-MiniLM-L6-v2`.
   * The bundled model when unset.
   */
  model?: string;
  /**
   * How the token vectors become one vector: their mean, or the first
   * token's. `mean` when unset. Every vector is L2-normalized either way.
   */
  pooling?: "mean" | "cls";
  texts: string[];
  /** Texts per forward pass. Progress is reported once per batch. */
  batchSize: number;
}

/**
 * Score each document against one query with a cross-encoder. The query and one
 * document go through the model together, so the score reads both, which makes
 * a cross-encoder more exact than comparing two vectors and too slow for more
 * than the top of a list. `server/ai/reranker.ts` sends these.
 */
export interface RerankJob {
  kind: "rerank";
  /** The Transformers.js model id, for example `Xenova/ms-marco-TinyBERT-L-2-v2`. */
  model: string;
  query: string;
  /** One profile text per candidate, in the order of the list. */
  docs: string[];
  /** Tokens per pair, the query and the document together. The rest is cut. */
  maxLength: number;
}

// Host to worker

export type HostMessage =
  { type: "run"; id: number; job: WorkerJob } | { type: "cancel"; id: number };

// Worker to host

export type WorkerMessage =
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "result"; id: number; payload: JobResult }
  | { type: "error"; id: number; message: string }
  /** Sent once, when the worker is up and its imports have resolved. */
  | { type: "ready" };

export type JobResult = EmbedResult | RerankResult;

/**
 * Vectors as one flat array, not an array of arrays: a flat `Float32Array` has
 * one ArrayBuffer, which `postMessage` can transfer instead of copying (two
 * thousand 384-wide vectors are three megabytes).
 */
export interface EmbedResult {
  kind: "embed";
  flat: Float32Array;
  count: number;
  dimension: number;
  /**
   * Whether this job needed the model. Loading it is a one-way door for the
   * whole process, so this tells a worker that can be replaced from one that
   * cannot (see `cpuWorker.ts`).
   */
  modelLoaded: boolean;
}

/** One relevance score per document, in the order the job sent them. */
export interface RerankResult {
  kind: "rerank";
  /** Higher is more relevant. The scale is the model's own logit. */
  scores: number[];
  /** Whether this job needed the model. See `EmbedResult.modelLoaded`. */
  modelLoaded: boolean;
}

/** Split a flat result back into one vector per row. */
export function unflatten(result: EmbedResult): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < result.count; i++) {
    out.push(
      result.flat.subarray(i * result.dimension, (i + 1) * result.dimension),
    );
  }
  return out;
}

/** The error a canceled job rejects with. Recognized by the host. */
export const CANCELLED = "job-cancelled";
