// =============================================================================
// The worker job protocol
// =============================================================================
// Shared by the host on the main thread and the worker on the other side of
// it. Nothing here imports the database, the AI gateway, or anything else
// heavy: the worker loads this file first, and a module graph that reached
// `server/db.ts` would re-run every migration in a second thread.
//
// Four message kinds, which is the whole protocol: start, progress, result,
// cancel. A job is identified by a number the host hands out, and every
// message the worker sends carries the id of the job it belongs to, so two
// jobs in flight cannot be confused for one.
//
// Cancelling is handled entirely on the host, which drops a job that has not
// been sent yet. The message kind is still here because the host is where the
// decision belongs and a running job may want it later; the worker ignores
// it, because nothing in the product cancels a running job and an untested
// path is worse than an absent one.
//
// One job kind. A second one for the dedupe passes was written and measured
// and then removed: after the quadratic self-joins came out of the
// deterministic pass and the futile KNN came out of the funnel, a scan of
// 50,000 contacts spends about 500 ms in those passes, and shipping the
// corpus across the thread boundary and back costs about 180 ms of it in
// structured clone on the main thread. The work was better removed than
// moved. `docs/multi-tenant-plan/15-additional-v2-features.md` has the
// numbers.
// =============================================================================

/** What a job asks the worker to do. */
export type WorkerJob = EmbedJob;

/**
 * Turn text into vectors.
 *
 * The worker holds the model; the main thread does every read and every
 * write. A backfill of 2,000 contacts blocked the event loop for 3.1 of its
 * 3.3 seconds before this, in bursts of up to 129 ms, which on a shared
 * instance is every other account's requests waiting.
 */
export interface EmbedJob {
  kind: "embed";
  texts: string[];
  /** Texts per forward pass. Progress is reported once per batch. */
  batchSize: number;
}

// ---------------------------------------------------------------------------
// Host to worker
// ---------------------------------------------------------------------------

export type HostMessage =
  { type: "run"; id: number; job: WorkerJob } | { type: "cancel"; id: number };

// ---------------------------------------------------------------------------
// Worker to host
// ---------------------------------------------------------------------------

export type WorkerMessage =
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "result"; id: number; payload: JobResult }
  | { type: "error"; id: number; message: string }
  /** Sent once, when the worker is up and its imports have resolved. */
  | { type: "ready" };

export type JobResult = EmbedResult;

/**
 * Vectors as one flat array, not an array of arrays.
 *
 * A flat `Float32Array` has one ArrayBuffer, which `postMessage` can transfer
 * instead of copying. Two thousand 384-wide vectors is three megabytes, and
 * copying it twice per backfill round is the cost this avoids.
 */
export interface EmbedResult {
  kind: "embed";
  flat: Float32Array;
  count: number;
  dimension: number;
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

/** The error a cancelled job rejects with. Recognised by the host. */
export const CANCELLED = "job-cancelled";
