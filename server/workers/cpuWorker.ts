// =============================================================================
// The CPU worker
// =============================================================================
// Runs on a `worker_threads` thread and holds the embedding model, which is
// the one piece of work that used to hold the event loop for seconds at a
// time. A backfill of 2,000 contacts blocked it for 2.19 of its 2.4 seconds,
// in bursts of up to 83 ms; through this worker the same backfill takes the
// same 2.4 seconds and blocks for 0.03.
//
// It has no database connection and no way to get one. Everything it needs
// arrives in the job, and everything it produces goes back to the main
// thread, which is the only thread that writes. That is how the single-writer
// rule survives a second thread: not by agreeing not to write, but by having
// nothing to write with.
//
// The module graph is the other constraint, and it is easy to break by
// accident. Importing anything that reaches `server/db.ts` would open the
// database a second time and re-run every migration on this thread. The
// imports below are the protocol and the model, and nothing else.
//
// ONE LOAD PER PROCESS. onnxruntime-node's native addon registers itself with
// the Node environment that loads it first, and every later load anywhere in
// the same process fails with "Module did not self-register" — including in
// the main thread, and including after the thread that loaded it has been
// terminated. Measured on linux/x64, which is what the image runs:
//
//   worker #1, first load in the process   ok
//   worker #2, after #1 was terminated     Module did not self-register
//   main thread, after #1 was terminated   Module did not self-register
//   a worker that never imports it         ok, as many times as you like
//
// Two rules come out of that, and both are in `cpuHost.ts`: this worker is
// never replaced once it has been spawned, and the in-process fallback is
// only reachable when the worker never started at all. The third is here: a
// job with nothing to embed must not touch the model, or every empty job
// spends the process's one load.
// =============================================================================

import { parentPort } from "worker_threads";
import path from "path";
import {
  type EmbedJob,
  type HostMessage,
  type WorkerMessage,
} from "./protocol.ts";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

if (!parentPort) {
  throw new Error("cpuWorker.ts was imported on the main thread");
}
const port = parentPort;

function send(message: WorkerMessage, transfer?: Transferable[]): void {
  port.postMessage(message, transfer as never);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<void> | null = null;

/**
 * Load the model once, on this thread.
 *
 * The main thread no longer loads it at all, so there is one copy in memory
 * rather than two. The cache directory is read the same way the in-process
 * version read it, because it is the same model files.
 */
async function ensureModel(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      const cacheDir =
        process.env.TRANSFORMERS_CACHE ??
        (process.env.DATA_DIR
          ? path.join(process.env.DATA_DIR, ".cache")
          : undefined);
      if (cacheDir) env.cacheDir = cacheDir;
      extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        {
          dtype: "q8",
          session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
        },
      );
    })();
  }
  await loading;
  if (!extractor) throw new Error("The embedding model did not load");
  return extractor;
}

/**
 * Embed every text, a batch at a time.
 *
 * The batching is what makes progress meaningful and keeps memory bounded: one
 * forward pass over two thousand texts would be one long call with nothing to
 * report and every vector alive at once.
 */
async function runEmbed(id: number, job: EmbedJob): Promise<void> {
  const { texts, batchSize } = job;

  // Nothing to embed, so nothing to load. Not an optimization: loading the
  // model is the one irreversible thing this process can do, and spending it
  // on a job with no texts would leave a worker that can never be replaced in
  // exchange for no vectors at all.
  if (texts.length === 0) {
    send({
      type: "result",
      id,
      payload: {
        kind: "embed",
        flat: new Float32Array(0),
        count: 0,
        dimension: 0,
        modelLoaded: false,
      },
    });
    return;
  }

  const model = await ensureModel();
  let dimension = 0;
  const rows: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await model(batch, { pooling: "mean", normalize: true });
    for (const row of output.tolist() as number[][]) {
      if (dimension === 0) dimension = row.length;
      rows.push(row);
    }
    send({ type: "progress", id, done: rows.length, total: texts.length });
  }

  const flat = new Float32Array(rows.length * dimension);
  rows.forEach((row, i) => flat.set(row, i * dimension));
  send(
    {
      type: "result",
      id,
      payload: {
        kind: "embed",
        flat,
        count: rows.length,
        dimension,
        modelLoaded: true,
      },
    },
    // Transferred, not copied. The worker gives up the buffer, which is
    // correct: it has no use for it once it is sent.
    [flat.buffer],
  );
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

port.on("message", (message: HostMessage) => {
  // Cancelling happens on the host, which drops a job that has not been sent
  // yet. Stopping one that is already running would mean checking a flag
  // between batches here, and that is deliberately not built: nothing in the
  // product cancels a running job, and a path with no caller and no test is
  // worse than a path that is not there.
  if (message.type === "cancel") return;

  const { id, job } = message;
  runEmbed(id, job).catch((err: unknown) => {
    send({
      type: "error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  });
});

send({ type: "ready" });
