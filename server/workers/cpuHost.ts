// The main thread's side of the CPU worker. It spawns the worker when first
// needed, runs one job at a time and reports progress. The queue is a run lock:
// two accounts backfilling at once take turns on one thread instead of fighting
// for the main event loop.
//
// ONE WORKER PER PROCESS, NEVER REPLACED. onnxruntime-node's native addon
// registers with the first Node environment that loads it, and every later load
// anywhere in the process fails with "Module did not self-register": in another
// worker, in the main thread, even after the first thread ended (`cpuWorker.ts`
// has the table). So a dead worker cannot be replaced, and the in-process
// fallback cannot work once the worker loaded the model. The host falls back
// only when the worker never started, and otherwise says plainly that
// embeddings are gone for the life of the process.
//
// A worker that never spawns (an unusual Node build, a sandbox without threads,
// a packaging mistake) is what the fallback is for: the model was never loaded,
// so the main thread can load it. The failure is logged once.

import { Worker } from "worker_threads";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import {
  CANCELLED,
  type HostMessage,
  type JobResult,
  type WorkerJob,
  type WorkerMessage,
} from "./protocol.ts";

/** Called as a job makes progress. */
export type ProgressFn = (done: number, total: number) => void;

interface Pending {
  resolve: (result: JobResult) => void;
  reject: (err: Error) => void;
  onProgress?: ProgressFn;
}

/**
 * How long to wait for the worker to say it is up. Generous, because the first
 * spawn resolves modules through the TypeScript loader. A ceiling on a startup
 * failure, not a budget.
 */
const READY_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/**
 * True once the worker failed and the host stopped trying. A worker that cannot
 * spawn will not start later, and retrying per call would log one warning per
 * contact of a backfill.
 */
let disabled = false;

/**
 * True once a worker reported a job that loaded the model. The process has then
 * spent its single onnxruntime load, so neither a new worker nor the main
 * thread can embed, and a fallback would fail again with the wrong reason.
 */
let modelSpent = false;

/** True once a worker has been spawned, whether or not it is still running. */
let everSpawned = false;

/** Set by tests to force the fallback path. */
let forceFallback = process.env.DISABLE_CPU_WORKER === "true";

/** The queue. One job at a time, in the order they were asked for. */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Jobs the caller asked to stop before they reached the worker. Such a job is
 * dropped here, so canceling a backfill queued behind another works. A
 * running job is sent a cancel, which the worker ignores (cpuWorker.ts).
 */
const canceledJobs = new Set<number>();

/**
 * The most jobs ever posted to the worker at once: one, if the queue works.
 * Counted where a job is posted, not sampled, so a host that stopped
 * serializing shows up whatever the jobs cost.
 */
let maxInFlight = 0;

function workerUrl(): URL {
  return new URL("./cpuWorker.ts", import.meta.url);
}

/** Spawn the worker, or return the one already running. */
function ensureWorker(): Promise<Worker> {
  if (ready) return ready;
  if (modelSpent) {
    return Promise.reject(
      new Error(
        "The CPU worker stopped after loading the embedding model. " +
          "onnxruntime-node can only be loaded once per process, so no " +
          "replacement worker can embed anything. Restart the server.",
      ),
    );
  }
  everSpawned = true;

  ready = new Promise<Worker>((resolve, reject) => {
    let settled = false;
    const spawned = new Worker(workerUrl());

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      spawned.terminate().catch(() => {});
      reject(
        new Error(`The CPU worker did not start within ${READY_TIMEOUT_MS}ms`),
      );
    }, READY_TIMEOUT_MS);

    spawned.on("message", (message: WorkerMessage) => {
      if (message.type === "ready") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker = spawned;
        // Ref the worker now, not before: until it is up nothing else holds the
        // event loop open, and an unref'd worker let the process exit while it
        // was still resolving its imports.
        refIfBusy();
        resolve(spawned);
        return;
      }
      handle(message);
    });

    spawned.on("error", (err: unknown) => {
      const failure = err instanceof Error ? err : new Error(String(err));
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(failure);
        return;
      }
      // A crash mid-job. Every job in flight fails, and the next call spawns
      // a new worker rather than hanging on a thread that is gone.
      failAll(failure);
    });

    spawned.on("exit", (code) => {
      worker = null;
      ready = null;
      if (pending.size > 0) {
        failAll(new Error(`The CPU worker exited with code ${String(code)}`));
      }
    });

    // Nothing is unref'd here. `refIfBusy` holds the reference while a job runs
    // and releases it when the queue is empty. With the worker unref'd from the
    // start, the main thread awaited a result only the worker could give, Node
    // saw nothing keeping the loop alive, and the process exited mid-backfill
    // with "Detected unsettled top-level await".
  });

  return ready;
}

function handle(message: WorkerMessage): void {
  if (message.type === "ready") return;
  const entry = pending.get(message.id);
  if (!entry) return;

  if (message.type === "progress") {
    entry.onProgress?.(message.done, message.total);
    return;
  }
  pending.delete(message.id);
  if (message.type === "result") {
    // Either kind of job can be the first to load onnxruntime on the worker.
    if (message.payload.modelLoaded) modelSpent = true;
    entry.resolve(message.payload);
  } else {
    entry.reject(new Error(message.message));
  }
  refIfBusy();
}

/** Hold the process open while a job is running, and let go when idle. */
function refIfBusy(): void {
  if (!worker) return;
  if (pending.size > 0) worker.ref();
  else worker.unref();
}

function failAll(err: Error): void {
  for (const [, entry] of pending) entry.reject(err);
  pending.clear();
  refIfBusy();
}

/**
 * Run one job on the worker, queued behind whatever runs. Rejects rather than
 * falling back: only the caller knows what running in process would cost.
 */
function submit(
  job: WorkerJob,
  onProgress?: ProgressFn,
): { id: number; result: Promise<JobResult> } {
  const id = nextId++;
  const result = (tail = tail.then(
    () =>
      new Promise<JobResult>((resolve, reject) => {
        void ensureWorker().then(
          (active) => {
            if (canceledJobs.delete(id)) {
              reject(new Error(CANCELLED));
              return;
            }
            pending.set(id, { resolve, reject, onProgress });
            maxInFlight = Math.max(maxInFlight, pending.size);
            refIfBusy();
            const message: HostMessage = { type: "run", id, job };
            active.postMessage(message);
          },
          (err: unknown) =>
            reject(err instanceof Error ? err : new Error(String(err))),
        );
      }),
  )) as Promise<JobResult>;

  // A rejection the caller handles must not also surface as an unhandled
  // rejection on the queue's tail.
  tail = result.catch(() => undefined);
  return { id, result };
}

/**
 * Stop a job. A queued job never reaches the worker. A running job is sent a
 * cancel, which the worker ignores, so it runs to the end.
 */
export function cancelJob(id: number): void {
  if (!pending.has(id)) {
    canceledJobs.add(id);
    return;
  }
  const message: HostMessage = { type: "cancel", id };
  worker?.postMessage(message);
}

/**
 * Run `job` on the worker, or `fallback` in process when it cannot. The
 * fallback is not a retry: a product that stops embedding because a thread
 * would not start silently stops finding anything, which is worse than the
 * event-loop cost.
 */
export async function runOnWorker<T>(
  job: WorkerJob,
  fallback: () => Promise<T>,
  translate: (result: JobResult) => T,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (disabled || forceFallback) return fallback();

  try {
    const { id, result } = submit(job, onProgress);
    const cancel = () => cancelJob(id);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const payload = await result;
      signal?.throwIfAborted();
      return translate(payload);
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  } catch (err: unknown) {
    signal?.throwIfAborted();
    if (getErrorMessage(err) === CANCELLED) throw err;

    // The model is already loaded somewhere in this process, so running in
    // process would fail too, with an error naming the wrong problem.
    if (modelSpent) {
      log.error(
        "CpuWorker",
        `The CPU worker failed after loading the embedding model, and the ` +
          `model cannot be loaded again in this process. Embeddings are ` +
          `unavailable until the server restarts: ${getErrorMessage(err)}`,
      );
      throw err instanceof Error ? err : new Error(String(err));
    }

    disabled = true;
    log.warn(
      "CpuWorker",
      `Falling back to in-process work for the rest of this run: ${getErrorMessage(err)}`,
    );
    return fallback();
  }
}

/** Start a job and get its id back, so a caller can cancel it. */
export function startJob(
  job: WorkerJob,
  onProgress?: ProgressFn,
): { id: number; result: Promise<JobResult> } {
  return submit(job, onProgress);
}

/**
 * The most jobs the host ever had on the worker at once, for tests: a run lock
 * that does not lock passes every test and then corrupts an ONNX session when
 * two accounts backfill together.
 */
export function __maxInFlight(): number {
  return maxInFlight;
}

/** True when work is going to the worker rather than the event loop. */
export function isWorkerActive(): boolean {
  return !disabled && !forceFallback;
}

/**
 * True once this process has spent its single onnxruntime load, for the health
 * panel and tests. Only a restart undoes it.
 */
export function isModelSpent(): boolean {
  return modelSpent;
}

/** True once a worker has been spawned, whether or not it is still running. */
export function hasSpawnedWorker(): boolean {
  return everSpawned;
}

/** Stop the worker. Called when the server shuts down, and by tests. */
export async function stopCpuWorker(): Promise<void> {
  const running = worker;
  worker = null;
  ready = null;
  failAll(new Error("The CPU worker was stopped"));
  if (running) await running.terminate();
}

/**
 * Put the host back to its starting state, for tests. `disabled` is sticky on
 * purpose in production, and a test of the fallback would otherwise leave every
 * later test in the file running in process.
 */
export async function __resetCpuWorker(
  options: { fallbackOnly?: boolean } = {},
): Promise<void> {
  await stopCpuWorker();
  canceledJobs.clear();
  maxInFlight = 0;
  // Tests only: a process that loaded the model cannot start over. Every test
  // that resets uses jobs with no texts, which never reach the model.
  modelSpent = false;
  everSpawned = false;
  disabled = false;
  forceFallback =
    options.fallbackOnly ?? process.env.DISABLE_CPU_WORKER === "true";
  nextId = 1;
  tail = Promise.resolve();
}
