/**
 * The connector sync scheduler. One tick, which the recurring job
 * `connectors.tick` runs every 60 seconds with background jobs on
 * (server/jobs/connectors.ts):
 * - selects due active connectors (nextRunAt <= now)
 * - runs at most CONNECTOR_SYNC_CONCURRENCY (default 2)
 * - runs at most one connector per owner per tick
 * - runs each sync inside runWithContext with the owner's scope
 * - stops on shutdown through an AbortSignal
 * - gives each sync a deadline, after which its slots are free
 *
 * A tick starts the syncs and returns. A sync somebody starts by hand (`POST
 * /api/connectors/:id/sync`) takes the same lock through `startSync`, so a
 * connector never runs twice at once.
 *
 * @module server/connectors/scheduler
 */

import crypto from "node:crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { scopeForOwnerId, type Scope } from "../tenancy/scope.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import { runNow } from "./service.ts";

/**
 * The longest one sync may run. Past it the sync's signal aborts every Google
 * call and IMAP command it waits on. Every call has its own timeout too; this
 * catches a sync that hangs some other way. A first sync of a large mailbox can
 * take most of an hour.
 */
const SYNC_DEADLINE_MS = 2 * 60 * 60_000;

/**
 * How long an aborted sync may still hold its slots. A sync that does not
 * end when it is aborted gives them back anyway, so it cannot stop every
 * other connector until a restart.
 */
const ABORT_GRACE_MS = 30_000;

let abortController: AbortController | null = null;

/** The connectors syncing now. */
const activeRuns = new Set<string>();
/** The owners with a sync running, and how many. */
const activeOwners = new Map<string, number>();
const runningPromises = new Set<Promise<void>>();

type RunResult = Awaited<ReturnType<typeof runNow>>;

/**
 * Run one connector's sync under the scheduler's rules. The connector is locked
 * while it runs, and its owner counts as busy, so a tick starts nothing else
 * for that owner. The sync stops at shutdown and at its deadline. Its slots
 * free up when it ends, or `ABORT_GRACE_MS` after its deadline if it does not.
 *
 * @returns The run, or null when the connector is syncing already.
 */
export function startSync(
  scope: Scope,
  connector: { id: string; ownerId: string },
  trigger: "schedule" | "manual",
): Promise<RunResult> | null {
  if (activeRuns.has(connector.id)) return null;
  activeRuns.add(connector.id);
  activeOwners.set(
    connector.ownerId,
    (activeOwners.get(connector.ownerId) ?? 0) + 1,
  );

  abortController ??= new AbortController();
  const deadline = new AbortController();
  const signal = AbortSignal.any([abortController.signal, deadline.signal]);

  let freed = false;
  const free = () => {
    if (freed) return;
    freed = true;
    clearTimeout(timer);
    activeRuns.delete(connector.id);
    const owners = (activeOwners.get(connector.ownerId) ?? 1) - 1;
    if (owners > 0) activeOwners.set(connector.ownerId, owners);
    else activeOwners.delete(connector.ownerId);
  };
  const timer = setTimeout(() => {
    log.warn("Connectors", `Sync of ${connector.id} passed its deadline`);
    deadline.abort(new Error("The sync ran past its deadline and stopped."));
    setTimeout(free, ABORT_GRACE_MS).unref();
  }, SYNC_DEADLINE_MS);
  timer.unref();

  const run = runNow(scope, connector.id, trigger, signal);
  const task = run.then(free, free);
  runningPromises.add(task);
  void task.finally(() => runningPromises.delete(task));
  return run;
}

/**
 * `running` is true from the first tick until stopConnectorScheduler, the
 * time in which a sync may be in flight.
 */
export function getSchedulerState(): {
  running: boolean;
  activeRunsCount: number;
  activeOwnersCount: number;
} {
  return {
    running: abortController !== null,
    activeRunsCount: activeRuns.size,
    activeOwnersCount: activeOwners.size,
  };
}

export async function tickScheduler(): Promise<void> {
  if (abortController?.signal.aborted) return;
  if (!abortController) {
    abortController = new AbortController();
  }

  const maxConcurrency = Math.max(
    1,
    parseInt(process.env.CONNECTOR_SYNC_CONCURRENCY || "2", 10) || 2,
  );

  const availableSlots = maxConcurrency - activeRuns.size;
  if (availableSlots <= 0) {
    return;
  }

  const nowIso = new Date().toISOString();

  // tenant-lint: allow instance sweep
  const dueRows = sqlite
    .prepare(
      `SELECT id, ownerId, kind, name
       FROM connectors
       WHERE status = 'active'
         AND (nextRunAt IS NULL OR nextRunAt <= ?)
       ORDER BY nextRunAt ASC`,
    )
    .all(nowIso) as Array<{
    id: string;
    ownerId: string;
    kind: string;
    name: string;
  }>;

  const candidates: Array<{
    id: string;
    ownerId: string;
    kind: string;
    name: string;
  }> = [];
  const tickOwners = new Set<string>();

  for (const row of dueRows) {
    if (candidates.length >= availableSlots) break;
    if (activeRuns.has(row.id)) continue;
    if (activeOwners.has(row.ownerId)) continue;
    if (tickOwners.has(row.ownerId)) continue;

    candidates.push(row);
    tickOwners.add(row.ownerId);
  }

  for (const candidate of candidates) {
    const scope = scopeForOwnerId(candidate.ownerId);
    const rid = crypto.randomUUID().slice(0, 8);

    runWithContext(
      { requestId: `conn-sync-${rid}`, principal: null, scope },
      () => startSync(scope, candidate, "schedule"),
    )?.catch((err: unknown) => {
      log.error(
        "Connectors",
        `Scheduler run failed for connector ${candidate.id}`,
        {
          error: err,
        },
      );
    });
  }
}

/**
 * Shutdown: abort the syncs in flight and wait up to five seconds for them.
 * The job runner stops the ticks themselves.
 */
export async function stopConnectorScheduler(): Promise<void> {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  // Await any in-flight runs (with 5s deadline)
  if (runningPromises.size > 0) {
    await Promise.race([
      Promise.allSettled(Array.from(runningPromises)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  activeRuns.clear();
  activeOwners.clear();
  runningPromises.clear();
  log.info("Connectors", "Connector background scheduler stopped");
}
