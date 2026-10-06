// The CPU worker, on a `worker_threads` thread. It holds the embedding model,
// which would otherwise hold the event loop for seconds at a time (a backfill
// of 2,000 contacts blocked it for 2.19 of its 2.4 seconds, in bursts of up to
// 83 ms; through the worker it takes the same 2.4 seconds and blocks for 0.03),
// and the search cross-encoder, a few milliseconds per job.
//
// It has no database connection and no way to get one: everything it needs
// arrives in the job, and everything it makes goes back to the main thread, the
// only writer. The module graph must stay that way: anything that reaches
// `server/db.ts` would open the database again and re-run every migration on
// this thread, so the imports are the protocol and the models only.
//
// ONE LOAD PER PROCESS. onnxruntime-node's native addon registers with the
// first Node environment that loads it, and every later load in the process
// fails with "Module did not self-register", in the main thread too, even after
// the first thread ended. On linux/x64, the image's platform:
//
//   worker #1, first load in the process   ok
//   worker #2, after #1 was terminated     Module did not self-register
//   main thread, after #1 was terminated   Module did not self-register
//   a worker that never imports it         ok, as many times as you like
//
// So this worker is never replaced once spawned, and the in-process fallback
// runs only when the worker never started (both in `cpuHost.ts`). And here, a
// job with nothing to embed must not touch the model, or an empty job would
// spend the process's one load.

import { parentPort } from "worker_threads";
import {
  type EmbedJob,
  type HostMessage,
  type RerankJob,
  type WorkerMessage,
} from "./protocol.ts";
import {
  EMBEDDING_MODEL_ID,
  configureModelLibrary,
} from "../services/search/modelFiles.ts";
import type {
  FeatureExtractionPipeline,
  PreTrainedModel,
  PreTrainedTokenizer,
} from "@huggingface/transformers";

if (!parentPort) {
  throw new Error("cpuWorker.ts was imported on the main thread");
}
const port = parentPort;

function send(message: WorkerMessage, transfer?: Transferable[]): void {
  port.postMessage(message, transfer as never);
}

// The models

/**
 * The library, reading the model folder and the cache the way the server
 * does, and downloading only when `MODEL_DOWNLOADS` allows it.
 */
async function transformers() {
  const library = await import("@huggingface/transformers");
  configureModelLibrary(library.env);
  return library;
}

/** The same session options for every model: two threads, one pass at a time. */
const SESSION_OPTIONS = { intraOpNumThreads: 2, interOpNumThreads: 1 };

/**
 * Embedding models by id, each loaded once, on this thread only, so there is
 * one copy in memory. The server uses one; the benchmark compares several in
 * one process, hence a map. A failed load is removed, so the next job tries
 * again.
 */
const extractors = new Map<string, Promise<FeatureExtractionPipeline>>();

function ensureExtractor(id: string): Promise<FeatureExtractionPipeline> {
  let loaded = extractors.get(id);
  if (!loaded) {
    loaded = (async () => {
      const { pipeline } = await transformers();
      return pipeline("feature-extraction", id, {
        dtype: "q8",
        session_options: SESSION_OPTIONS,
      });
    })();
    extractors.set(id, loaded);
    loaded.catch(() => extractors.delete(id));
  }
  return loaded;
}

interface CrossEncoder {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

/**
 * Cross-encoders by id, each loaded once. The server uses one; the benchmark
 * compares two in one process, hence a map. A failed load is removed, so one
 * bad download does not fail forever.
 */
const crossEncoders = new Map<string, Promise<CrossEncoder>>();

function ensureCrossEncoder(id: string): Promise<CrossEncoder> {
  let loaded = crossEncoders.get(id);
  if (!loaded) {
    loaded = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification } =
        await transformers();
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(id),
        AutoModelForSequenceClassification.from_pretrained(id, {
          dtype: "q8",
          session_options: SESSION_OPTIONS,
        }),
      ]);
      return { tokenizer, model };
    })();
    crossEncoders.set(id, loaded);
    loaded.catch(() => crossEncoders.delete(id));
  }
  return loaded;
}

/**
 * Score every document against the query in one forward pass. Each pair is the
 * query and one document, cut to `maxLength` tokens; an MS MARCO cross-encoder
 * returns one logit per pair, which is the score. No documents means no model,
 * for the reason `runEmbed` gives.
 */
async function runRerank(id: number, job: RerankJob): Promise<void> {
  if (job.docs.length === 0) {
    send({
      type: "result",
      id,
      payload: { kind: "rerank", scores: [], modelLoaded: false },
    });
    return;
  }
  const { tokenizer, model } = await ensureCrossEncoder(job.model);
  const inputs = tokenizer(new Array<string>(job.docs.length).fill(job.query), {
    text_pair: job.docs,
    padding: true,
    truncation: true,
    max_length: job.maxLength,
  });
  const { logits } = (await model(inputs)) as {
    logits: { tolist(): number[][] };
  };
  send({
    type: "result",
    id,
    payload: {
      kind: "rerank",
      scores: logits.tolist().map((row) => row[0]),
      modelLoaded: true,
    },
  });
}

/**
 * Embed every text, a batch at a time, so progress means something and memory
 * stays bounded: one pass over two thousand texts would report nothing and keep
 * every vector alive at once.
 */
async function runEmbed(id: number, job: EmbedJob): Promise<void> {
  const { texts, batchSize } = job;

  // Nothing to embed, so nothing to load. Loading the model is the one
  // irreversible thing this process can do, and spending it on an empty job
  // would leave a worker that can never be replaced, for no vectors.
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

  const model = await ensureExtractor(job.model ?? EMBEDDING_MODEL_ID);
  const pooling = job.pooling ?? "mean";
  let dimension = 0;
  const rows: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await model(batch, { pooling, normalize: true });
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

// The loop

port.on("message", (message: HostMessage) => {
  // The host drops a canceled job that has not been sent. A running job is not
  // stopped here: nothing in the product cancels one, and a path with no caller
  // and no test is worse than none.
  if (message.type === "cancel") return;

  const { id, job } = message;
  const run = job.kind === "rerank" ? runRerank(id, job) : runEmbed(id, job);
  run.catch((err: unknown) => {
    send({
      type: "error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  });
});

send({ type: "ready" });
