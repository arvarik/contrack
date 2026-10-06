// The job runner: background work from one durable table.
//
// Every piece of background work is a row in `jobs` with a kind, an owner (none
// for the instance's own work), a payload and a time to run. A kind is declared
// once in code (`defineJob`) and registered in the process that runs it. The
// runner:
//
// - polls once a second while background jobs are on, and runs at most
//   JOB_CONCURRENCY jobs at once (default 2);
// - takes turns between owners, so one account's backlog never holds up
//   another's. Instance jobs take their turn as one owner;
// - runs an owner's job inside runWithContext with that owner's scope;
// - retries a job that throws, with backoff, until its `maxAttempts`, then
//   leaves it `failed` with the error;
// - at boot queues every `running` row again, because the process that ran it
//   is gone;
// - keeps one queued row for each recurring kind (`every`) through its
//   `dedupeKey`. A run that ends schedules the next, and the finished row stays
//   for the admin route until maintenance removes it.
//
// `runJobNow` runs a job in the calling process and records it, even with
// DISABLE_BACKGROUND_JOBS=true, as every test runs. A test also calls
// `pollJobs`, the poll's own step.
//
// `jobs` is not an owned table (an instance job has no owner), so its
// statements say why they name no owner.

import crypto from "node:crypto";
import type { ZodType } from "zod";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import { scopeForOwnerId, type Scope } from "../tenancy/scope.ts";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** What a running job knows about itself. */
export interface JobContext {
  /** The row's id. */
  id: string;
  kind: string;
  /**
   * The owner's scope, or null for the instance's own work. An owner's job
   * already runs inside runWithContext with this scope.
   */
  scope: Scope | null;
  /** 1 on the first try. */
  attempt: number;
}

/**
 * One kind of background work. `every` and `atStart` say when it runs by
 * itself:
 * - `every` makes it recurring: the gap in milliseconds from the end of one run
 *   to the start of the next. A function is read at each scheduling, for a gap
 *   a setting can change. Null or 0 turns it off.
 * - `atStart` runs it when the runner starts: `true` at once, a number that
 *   many milliseconds later. Without `every`, that is the only time it runs.
 *
 * A kind with neither runs when something enqueues it, or through runJobNow.
 */
export interface JobDefinition<P = Record<string, unknown>> {
  kind: string;
  /** The work. Method syntax, so a definition with a typed payload registers. */
  run(payload: P, context: JobContext): unknown;
  /** Parses the payload when the job is enqueued and again when it runs. */
  payload?: ZodType<P>;
  /** Tries before the job ends `failed`. Default 3. */
  maxAttempts?: number;
  every?: number | (() => number | null);
  atStart?: boolean | number;
}

/** A recurring job, as GET /api/admin/jobs reports it. */
export interface RecurringJobState {
  kind: string;
  /** Milliseconds between runs, or null when it is switched off. */
  every: number | null;
  lastRunAt: string | null;
  lastStatus: JobStatus | null;
  nextRunAt: string | null;
}

/** A job that ended `failed`. */
export interface FailedJob {
  id: string;
  kind: string;
  ownerId: string | null;
  lastError: string | null;
  finishedAt: string | null;
}

/** How often the runner looks for due jobs. */
export const POLL_INTERVAL_MS = 1_000;
export const DEFAULT_JOB_CONCURRENCY = 2;
export const DEFAULT_MAX_ATTEMPTS = 3;
/** The wait before a retry doubles from this, up to an hour. */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
/** How far back the admin route lists failed jobs. */
const FAILED_WINDOW_MS = 24 * 60 * 60_000;

/** Typed help for writing a definition. Returns it unchanged. */
export function defineJob<P = Record<string, unknown>>(
  definition: JobDefinition<P>,
): JobDefinition<P> {
  return definition;
}

const kinds = new Map<string, JobDefinition<unknown>>();

/**
 * Add a kind. Idempotent by kind: the modules list the same definitions as
 * the code that registers them, and the first one stays.
 */
export function registerJob(definition: JobDefinition<unknown>): void {
  if (!kinds.has(definition.kind)) kinds.set(definition.kind, definition);
}

export function registerJobs(
  definitions: readonly JobDefinition<unknown>[],
): void {
  for (const definition of definitions) registerJob(definition);
}

/**
 * JOB_CONCURRENCY: the most jobs that run at once, an integer of at least 1.
 * Anything else is logged once and the default is used.
 */
let warnedConcurrency: string | null = null;
export function jobConcurrency(): number {
  const raw = process.env.JOB_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_JOB_CONCURRENCY;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 1) return value;
  if (warnedConcurrency !== raw) {
    warnedConcurrency = raw;
    log.warn(
      "Jobs",
      `JOB_CONCURRENCY must be an integer of at least 1, and "${raw}" is not. Running ${DEFAULT_JOB_CONCURRENCY} at once.`,
    );
  }
  return DEFAULT_JOB_CONCURRENCY;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** The key that holds a recurring kind's one next run. */
const recurringKey = (kind: string): string => `recurring:${kind}`;
/** The key that holds a start-up job's one run. */
const startKey = (kind: string): string => `start:${kind}`;

function intervalOf(definition: JobDefinition<unknown>): number | null {
  const every =
    typeof definition.every === "function"
      ? definition.every()
      : definition.every;
  return typeof every === "number" && Number.isFinite(every) && every > 0
    ? every
    : null;
}

function startDelayOf(definition: JobDefinition<unknown>): number | null {
  if (definition.atStart === true) return 0;
  if (typeof definition.atStart === "number") {
    return Math.max(0, definition.atStart);
  }
  return null;
}

// Writing rows

/**
 * Put a row in the queue, or move the queued row that holds `dedupeKey`.
 * Returns the row's id, or null when a running row holds the key.
 */
function upsertQueued(
  kind: string,
  ownerId: string | null,
  payload: string,
  runAt: number,
  maxAttempts: number,
  dedupeKey: string | null,
): string | null {
  const row = sqlite
    .prepare(
      // The owner, when there is one, comes from the caller.
      // tenant-lint: allow owner-checked by caller
      `INSERT INTO jobs (id, kind, ownerId, payload, status, runAt, maxAttempts, dedupeKey, createdAt)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)
       ON CONFLICT(dedupeKey) WHERE status IN ('queued', 'running')
       DO UPDATE SET runAt = excluded.runAt, payload = excluded.payload,
                     maxAttempts = excluded.maxAttempts
       WHERE jobs.status = 'queued'
       RETURNING id`,
    )
    .get(
      crypto.randomUUID(),
      kind,
      ownerId,
      payload,
      iso(runAt),
      maxAttempts,
      dedupeKey,
      iso(Date.now()),
    ) as { id: string } | undefined;
  return row?.id ?? null;
}

function cancelQueued(dedupeKey: string): void {
  sqlite
    .prepare(
      // tenant-lint: allow instance sweep
      `UPDATE jobs SET status = 'cancelled', finishedAt = ?
        WHERE dedupeKey = ? AND status = 'queued'`,
    )
    .run(iso(Date.now()), dedupeKey);
}

export interface EnqueueOptions {
  /** The account the job works for. Null or absent for the instance. */
  ownerId?: string | null;
  /** When it may start, in epoch milliseconds. Now by default. */
  runAt?: number;
  /**
   * At most one queued or running row per key. A second enqueue with the key
   * of a queued row moves that row to the new time and payload, which is how
   * a burst of writes becomes one run.
   */
  dedupeKey?: string;
  maxAttempts?: number;
}

/**
 * Queue a job. It runs when due, in the process that polls (the server, with
 * background jobs on).
 *
 * @returns the row's id, or null when a running row holds `dedupeKey`. The
 *   running job read its input when it started, so a change that lands
 *   meanwhile waits for the next enqueue.
 */
export function enqueueJob(
  kind: string,
  payload: unknown = {},
  options: EnqueueOptions = {},
): string | null {
  const definition = kinds.get(kind);
  const body = definition?.payload
    ? definition.payload.parse(payload)
    : payload;
  return upsertQueued(
    kind,
    options.ownerId ?? null,
    JSON.stringify(body ?? {}),
    options.runAt ?? Date.now(),
    options.maxAttempts ?? definition?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    options.dedupeKey ?? null,
  );
}

/**
 * Set or clear the next run of a recurring kind, for a gap that a setting
 * changes at run time. Null cancels the queued run.
 */
export function scheduleNextRun(kind: string, runAt: number | null): void {
  if (runAt === null) {
    cancelQueued(recurringKey(kind));
    return;
  }
  upsertQueued(
    kind,
    null,
    "{}",
    runAt,
    kinds.get(kind)?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    recurringKey(kind),
  );
}

/** When a recurring kind runs next, or null when nothing is queued. */
export function nextRunOf(kind: string): string | null {
  const row = sqlite
    .prepare(
      // tenant-lint: allow instance sweep
      `SELECT runAt FROM jobs WHERE dedupeKey = ? AND status = 'queued'`,
    )
    .get(recurringKey(kind)) as { runAt: string } | undefined;
  return row?.runAt ?? null;
}

// Running rows

interface JobRow {
  id: string;
  kind: string;
  ownerId: string | null;
  payload: string;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
}

/** Jobs this process is running now, by id. */
const active = new Map<string, Promise<void>>();
/** The turn on which each owner last got a job. "" is the instance. */
const lastTurn = new Map<string, number>();
let turn = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let stopping = false;

async function runHandler(
  definition: JobDefinition<unknown>,
  row: JobRow,
  attempt: number,
): Promise<void> {
  const raw: unknown = JSON.parse(row.payload);
  const payload = definition.payload ? definition.payload.parse(raw) : raw;
  const scope = row.ownerId ? scopeForOwnerId(row.ownerId) : null;
  const context: JobContext = { id: row.id, kind: row.kind, scope, attempt };
  if (!scope) {
    await definition.run(payload, context);
    return;
  }
  await runWithContext(
    { requestId: `job-${row.id.slice(0, 8)}`, principal: null, scope },
    () => definition.run(payload, context),
  );
}

/** Record how a try ended, and schedule what comes after it. */
function settle(
  row: JobRow,
  definition: JobDefinition<unknown> | undefined,
  attempt: number,
  error: unknown,
): void {
  const now = Date.now();
  // Only the row that holds a recurring kind's key schedules its next run.
  // A runJobNow of the same kind is a run, not the schedule.
  const recurring =
    definition !== undefined &&
    definition.every !== undefined &&
    row.dedupeKey === recurringKey(row.kind);
  const scheduleNext = () => {
    if (!recurring) return;
    const every = intervalOf(definition);
    if (every !== null) {
      upsertQueued(
        row.kind,
        null,
        "{}",
        now + every,
        definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        recurringKey(row.kind),
      );
    }
  };

  try {
    if (error === null) {
      sqlite.transaction(() => {
        sqlite
          .prepare(
            // tenant-lint: allow instance sweep
            `UPDATE jobs SET status = 'done', finishedAt = ?, lastError = NULL WHERE id = ?`,
          )
          .run(iso(now), row.id);
        scheduleNext();
      })();
      return;
    }

    const message = getErrorMessage(error).slice(0, 2_000);
    if (definition !== undefined && attempt < row.maxAttempts) {
      const wait = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
      sqlite
        .prepare(
          // tenant-lint: allow instance sweep
          `UPDATE jobs SET status = 'queued', runAt = ?, lastError = ? WHERE id = ?`,
        )
        .run(iso(now + wait), message, row.id);
      log.warn(
        "Jobs",
        `${row.kind} failed on try ${attempt} of ${row.maxAttempts} and runs again in ${Math.round(wait / 1000)}s: ${message}`,
      );
      return;
    }

    sqlite.transaction(() => {
      sqlite
        .prepare(
          // tenant-lint: allow instance sweep
          `UPDATE jobs SET status = 'failed', finishedAt = ?, lastError = ? WHERE id = ?`,
        )
        .run(iso(now), message, row.id);
      // A failed run still schedules the next one.
      scheduleNext();
    })();
    log.error(
      "Jobs",
      `${row.kind} failed after ${attempt} ${attempt === 1 ? "try" : "tries"}: ${message}`,
    );
  } catch (bookkeeping) {
    // The database may be closing under a shutdown. The row stays `running`,
    // and the next boot queues it again.
    log.error(
      "Jobs",
      `Could not record the end of ${row.kind} ${row.id}: ${getErrorMessage(bookkeeping)}`,
    );
  }
}

async function execute(row: JobRow): Promise<void> {
  const definition = kinds.get(row.kind);
  const attempt = row.attempts + 1;
  let error: unknown = null;
  try {
    if (!definition) {
      throw new Error(`No job kind "${row.kind}" is registered here`);
    }
    await runHandler(definition, row, attempt);
  } catch (caught) {
    error = caught ?? new Error("The job threw without a reason");
  }
  settle(row, definition, attempt, error);
}

/**
 * The due jobs, at most `limit` per owner, in the order each owner would run
 * them. One owner's backlog cannot fill the window and hide another's.
 */
function dueJobs(now: number, limit: number): JobRow[] {
  return sqlite
    .prepare(
      // Every account's queue: the runner serves the instance, and each job
      // runs in its own owner's scope.
      // tenant-lint: allow instance sweep
      `SELECT id, kind, ownerId, payload, attempts, maxAttempts, dedupeKey
         FROM (
           SELECT *, ROW_NUMBER() OVER (
                     PARTITION BY ownerId ORDER BY runAt, createdAt, id
                   ) AS place
             FROM jobs
            WHERE status = 'queued' AND runAt <= ?
         )
        WHERE place <= ?
        ORDER BY runAt, createdAt, id`,
    )
    .all(iso(now), limit) as JobRow[];
}

/**
 * Pick up to `free` jobs, one owner at a time. The owner served longest ago
 * goes first, and an owner never served goes first of all.
 */
function takeTurns(due: JobRow[], free: number): JobRow[] {
  const byOwner = new Map<string, JobRow[]>();
  for (const row of due) {
    const owner = row.ownerId ?? "";
    const rows = byOwner.get(owner);
    if (rows) rows.push(row);
    else byOwner.set(owner, [row]);
  }
  // A stable sort: owners tied on their last turn keep the order of their
  // first due job.
  const owners = [...byOwner.keys()].sort(
    (a, b) => (lastTurn.get(a) ?? 0) - (lastTurn.get(b) ?? 0),
  );
  const picked: JobRow[] = [];
  while (picked.length < free) {
    let took = false;
    for (const owner of owners) {
      if (picked.length >= free) break;
      const next = byOwner.get(owner)?.shift();
      if (!next) continue;
      picked.push(next);
      lastTurn.set(owner, ++turn);
      took = true;
    }
    if (!took) break;
  }
  return picked;
}

/**
 * Start the jobs due at `now`, as many as JOB_CONCURRENCY allows beside those
 * running. Resolves when the jobs it started have ended. The poll calls it
 * every second, and it works with background jobs off, so a test can call it.
 */
export async function pollJobs(now: number = Date.now()): Promise<void> {
  if (stopping) return;
  const free = jobConcurrency() - active.size;
  if (free <= 0) return;

  const runs: Promise<void>[] = [];
  for (const row of takeTurns(dueJobs(now, free), free)) {
    const claimed = sqlite
      .prepare(
        // tenant-lint: allow instance sweep
        `UPDATE jobs SET status = 'running', attempts = attempts + 1, startedAt = ?
          WHERE id = ? AND status = 'queued'`,
      )
      .run(iso(Date.now()), row.id).changes;
    if (claimed === 0) continue;
    const run = execute(row).finally(() => active.delete(row.id));
    active.set(row.id, run);
    runs.push(run);
  }
  await Promise.all(runs);
}

/**
 * Run a job now, in this process, once. It is recorded like any other run.
 * Works with background jobs off.
 *
 * @returns the row's id.
 * @throws what the job threw, after the row is recorded `failed`.
 */
export async function runJobNow(
  kind: string,
  payload: unknown = {},
  options: { ownerId?: string | null } = {},
): Promise<string> {
  const definition = kinds.get(kind);
  if (!definition) throw new Error(`No job kind "${kind}" is registered here`);
  const body = definition.payload ? definition.payload.parse(payload) : payload;
  const row: JobRow = {
    id: crypto.randomUUID(),
    kind,
    ownerId: options.ownerId ?? null,
    payload: JSON.stringify(body ?? {}),
    attempts: 0,
    maxAttempts: 1,
    dedupeKey: null,
  };
  const now = iso(Date.now());
  sqlite
    .prepare(
      // tenant-lint: allow owner-checked by caller
      `INSERT INTO jobs (id, kind, ownerId, payload, status, runAt, attempts, maxAttempts, startedAt, createdAt)
       VALUES (?, ?, ?, ?, 'running', ?, 1, 1, ?, ?)`,
    )
    .run(row.id, kind, row.ownerId, row.payload, now, now, now);

  let error: unknown = null;
  try {
    await runHandler(definition, row, 1);
  } catch (caught) {
    error = caught ?? new Error("The job threw without a reason");
  }
  settle(row, definition, 1, error);
  if (error !== null) throw error;
  return row.id;
}

// Boot and shutdown

/**
 * Put every `running` row back in the queue: the process that ran it has
 * gone. A row that has used every try ends `failed` instead, so a job that
 * takes the process down cannot do it at every boot.
 *
 * @returns how many rows went back to the queue.
 */
export function requeueInterruptedJobs(): number {
  const now = iso(Date.now());
  return sqlite.transaction(() => {
    sqlite
      .prepare(
        // tenant-lint: allow instance sweep
        `UPDATE jobs SET status = 'failed', finishedAt = ?,
                lastError = 'The server stopped while it ran, on its last try'
          WHERE status = 'running' AND attempts >= maxAttempts`,
      )
      .run(now);
    return sqlite
      .prepare(
        // tenant-lint: allow instance sweep
        `UPDATE jobs SET status = 'queued', runAt = ?
          WHERE status = 'running'`,
      )
      .run(now).changes;
  })();
}

/**
 * Give every declared kind its queued run: a start-up job its one run, and a
 * recurring job its next. `atStart` runs now or after its delay, even when a
 * previous process queued a later run. A recurring job without it keeps the run
 * a previous process queued, brought forward when its gap has shrunk. A
 * recurring job that is switched off loses its queued run.
 */
export function scheduleDeclaredJobs(now: number = Date.now()): void {
  for (const definition of kinds.values()) {
    const start = startDelayOf(definition);
    if (definition.every === undefined) {
      if (start !== null) {
        upsertQueued(
          definition.kind,
          null,
          "{}",
          now + start,
          definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          startKey(definition.kind),
        );
      }
      continue;
    }

    const key = recurringKey(definition.kind);
    const every = intervalOf(definition);
    if (every === null) {
      cancelQueued(key);
      continue;
    }
    const queued = nextRunOf(definition.kind);
    const runAt =
      start !== null
        ? now + start
        : queued === null || Date.parse(queued) > now + every
          ? now + every
          : null;
    if (runAt === null) continue;
    upsertQueued(
      definition.kind,
      null,
      "{}",
      runAt,
      definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      key,
    );
  }
}

/**
 * Boot: queue again what the last process left running, then, when
 * background jobs are on, schedule the declared jobs and start the poll.
 *
 * @returns true when the poll started, false when background jobs are off.
 */
export function startJobRunner(): boolean {
  const requeued = requeueInterruptedJobs();
  if (requeued > 0) {
    log.info("Jobs", `Queued ${requeued} job(s) again that a restart stopped`);
  }
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return false;
  if (timer) return true;

  stopping = false;
  scheduleDeclaredJobs();
  timer = setInterval(() => void pollJobs(), POLL_INTERVAL_MS);
  timer.unref?.();
  void pollJobs();
  log.info(
    "Jobs",
    `Background jobs started: ${kinds.size} kinds, at most ${jobConcurrency()} at once`,
  );
  return true;
}

/**
 * Shutdown: stop the poll, start nothing more, and wait up to `deadlineMs`
 * for the jobs that are running. A job still running when the process exits
 * is queued again at the next boot.
 */
export async function stopJobRunner(deadlineMs = 5_000): Promise<void> {
  stopping = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (active.size === 0) return;
  await Promise.race([
    Promise.allSettled([...active.values()]),
    new Promise<void>((resolve) => setTimeout(resolve, deadlineMs).unref()),
  ]);
}

// The admin view

/**
 * Every recurring kind with its last run and its next, and the jobs that
 * failed in the last 24 hours. For GET /api/admin/jobs.
 */
export function jobsOverview(now: number = Date.now()): {
  recurring: RecurringJobState[];
  failed: FailedJob[];
} {
  const lastRun = sqlite.prepare(
    // The instance's work and every account's, for an admin.
    // tenant-lint: allow admin cross-user
    `SELECT status, startedAt, finishedAt FROM jobs
      WHERE kind = ? AND status IN ('running', 'done', 'failed')
      ORDER BY startedAt DESC LIMIT 1`,
  );
  const nextRun = sqlite.prepare(
    // tenant-lint: allow admin cross-user
    `SELECT runAt FROM jobs WHERE kind = ? AND status = 'queued'
      ORDER BY runAt LIMIT 1`,
  );

  const recurring: RecurringJobState[] = [];
  for (const definition of kinds.values()) {
    if (definition.every === undefined) continue;
    const last = lastRun.get(definition.kind) as
      | {
          status: JobStatus;
          startedAt: string | null;
          finishedAt: string | null;
        }
      | undefined;
    const next = nextRun.get(definition.kind) as { runAt: string } | undefined;
    recurring.push({
      kind: definition.kind,
      every: intervalOf(definition),
      lastRunAt: last ? (last.finishedAt ?? last.startedAt) : null,
      lastStatus: last?.status ?? null,
      nextRunAt: next?.runAt ?? null,
    });
  }

  const failed = sqlite
    .prepare(
      // tenant-lint: allow admin cross-user
      `SELECT id, kind, ownerId, lastError, finishedAt FROM jobs
        WHERE status = 'failed' AND finishedAt >= ?
        ORDER BY finishedAt DESC LIMIT 50`,
    )
    .all(iso(now - FAILED_WINDOW_MS)) as FailedJob[];

  return { recurring, failed };
}
