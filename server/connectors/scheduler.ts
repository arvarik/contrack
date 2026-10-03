/**
 * server/connectors/scheduler.ts — Background sync scheduler for connectors.
 *
 * One tick, which the recurring job `connectors.tick` runs every 60 seconds
 * when background jobs are enabled (server/jobs/connectors.ts):
 * - Selects due active connectors (nextRunAt <= now)
 * - Limits execution to CONNECTOR_SYNC_CONCURRENCY (default 2)
 * - Restricts to at most one connector per owner per tick
 * - Runs each sync inside runWithContext with owner scope
 * - Respects shutdown via AbortSignal
 *
 * A tick starts the syncs and returns. They run on, under these limits, and
 * stopConnectorScheduler aborts them at shutdown.
 *
 * @module server/connectors/scheduler
 */

import crypto from "node:crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { scopeForOwnerId } from "../tenancy/scope.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import { runNow } from "./service.ts";

let abortController: AbortController | null = null;

const activeRuns = new Set<string>();
const activeOwners = new Set<string>();
const runningPromises = new Set<Promise<void>>();

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
    activeRuns.add(candidate.id);
    activeOwners.add(candidate.ownerId);

    const scope = scopeForOwnerId(candidate.ownerId);
    const rid = crypto.randomUUID().slice(0, 8);
    const signal = abortController?.signal;

    const task = runWithContext(
      { requestId: `conn-sync-${rid}`, principal: null, scope },
      async () => {
        try {
          await runNow(scope, candidate.id, "schedule", signal);
        } catch (err: unknown) {
          log.error(
            "Connectors",
            `Scheduler run failed for ${candidate.name}`,
            {
              error: err,
            },
          );
        } finally {
          activeRuns.delete(candidate.id);
          activeOwners.delete(candidate.ownerId);
        }
      },
    );

    runningPromises.add(task);
    task.finally(() => runningPromises.delete(task));
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
