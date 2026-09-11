// =============================================================================
// The main thread's side of the CPU worker
// =============================================================================
// Spawns the worker when something first needs it, runs one job at a time,
// and reports progress. The queue here is the run lock the plan describes:
// two accounts asking for an embedding backfill at once take turns on one
// thread rather than fighting for the event loop on the main one.
//
// Everything has a fallback. A worker that will not spawn — an unusual Node
// build, a sandbox with no thread support, a packaging mistake — must not
// stop the product embedding anything, so every entry point below takes an
// in-process function to run instead, and uses it on the first failure and
// on every call after that. The failure is logged once, not per call.
// =============================================================================

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
 * How long to wait for the worker to say it is up.
 *
 * Generous: the first spawn pays for module resolution through the
 * TypeScript loader. It is a ceiling on a startup failure, not a budget.
 */
const READY_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/**
 * True once the worker has failed and the host has stopped trying.
 *
 * One failure is enough. A worker that cannot spawn will not start spawning
 * later, and retrying per call would turn one logged warning into one per
 * contact of a backfill.
 */
let disabled = false;

/** Set by tests to force the fallback path. */
let forceFallback = process.env.DISABLE_CPU_WORKER === "true";

/** The queue. One job at a time, in the order they were asked for. */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Jobs the caller has asked to stop.
 *
 * Cancelling has to work in two places, because a job spends most of its life
 * in neither. A job still in the queue is dropped here and never reaches the
 * worker at all; a job already running is forwarded, and the worker notices
 * between batches. Only forwarding would have meant that cancelling a
 * backfill queued behind another one did nothing.
 */
const cancelledJobs = new Set<number>();

/**
 * The most jobs that were ever posted to the worker at the same time.
 *
 * One, if the queue works. Recorded rather than sampled because sampling a
 * queue of fast jobs measures the timer rather than the queue: this is
 * incremented where the job is posted, so a host that stopped serializing
 * shows up whatever the jobs cost.
 */
let maxInFlight = 0;

function workerUrl(): URL {
  return new URL("./cpuWorker.ts", import.meta.url);
}

/** Spawn the worker, or return the one already running. */
function ensureWorker(): Promise<Worker> {
  if (ready) return ready;

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
        // Now, and not before. Until the worker says it is up there is
        // nothing else holding the event loop open, and a worker unref'd from
        // the moment it was constructed let the process exit while it was
        // still resolving its own imports.
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

    // Nothing is unref'd here. The reference is managed by `refIfBusy`, which
    // runs once the worker is up and after every job settles: held while a job
    // is running, released when the queue is empty.
    //
    // Getting that wrong was a real failure rather than a theoretical one.
    // With the worker unref'd from construction, the main thread awaited a
    // result only the worker could produce, Node saw nothing keeping the loop
    // alive, and the process exited mid-backfill with "Detected unsettled
    // top-level await".
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
  if (message.type === "result") entry.resolve(message.payload);
  else entry.reject(new Error(message.message));
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
 * Run one job on the worker.
 *
 * Queued behind whatever is already running. Rejects rather than falling back
 * — the fallback decision belongs to the caller, which is the only place that
 * knows what running in process would cost.
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
            if (cancelledJobs.delete(id)) {
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
 * Stop a job, whether it has started or not.
 *
 * A job still in the queue never reaches the worker. A job already running is
 * told, and stops at the next batch boundary.
 */
export function cancelJob(id: number): void {
  if (!pending.has(id)) {
    cancelledJobs.add(id);
    return;
  }
  const message: HostMessage = { type: "cancel", id };
  worker?.postMessage(message);
}

/**
 * Run `job` on the worker, or `fallback` in process when it cannot.
 *
 * The fallback is not a retry. If the worker is unavailable the work still
 * has to happen, and doing it on the event loop is worse than not doing it at
 * all only in theory: a product that stops embedding because a thread would
 * not start is a product that silently stops finding anything.
 */
export async function runOnWorker<T>(
  job: WorkerJob,
  fallback: () => Promise<T>,
  translate: (result: JobResult) => T,
  onProgress?: ProgressFn,
): Promise<T> {
  if (disabled || forceFallback) return fallback();

  try {
    const { result } = submit(job, onProgress);
    return translate(await result);
  } catch (err: unknown) {
    if (getErrorMessage(err) === CANCELLED) throw err;
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
 * The most jobs the host ever had on the worker at once. Tests only.
 *
 * The queue is the run lock the plan describes, and a run lock that does not
 * lock is the kind of thing that passes every test and then corrupts an ONNX
 * session under two accounts backfilling at the same time.
 */
export function __maxInFlight(): number {
  return maxInFlight;
}

/** True when work is going to the worker rather than the event loop. */
export function isWorkerActive(): boolean {
  return !disabled && !forceFallback;
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
 * Put the host back to its starting state.
 *
 * Tests only. `disabled` is sticky on purpose in production, and a test that
 * exercised the fallback would otherwise leave every later test in this file
 * running in process.
 */
export async function __resetCpuWorker(
  options: { fallbackOnly?: boolean } = {},
): Promise<void> {
  await stopCpuWorker();
  cancelledJobs.clear();
  maxInFlight = 0;
  disabled = false;
  forceFallback =
    options.fallbackOnly ?? process.env.DISABLE_CPU_WORKER === "true";
  nextId = 1;
  tail = Promise.resolve();
}
