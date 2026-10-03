// =============================================================================
// Jobs: connectors
// =============================================================================
// The scheduler tick, at start and every minute: it starts the syncs that are
// due, within the scheduler's own limits (CONNECTOR_SYNC_CONCURRENCY, one
// connector per owner per tick), and returns. A failed tick is not retried,
// because the next one is a minute away.
//
// The stored photo sweep, once, five seconds after boot.
// =============================================================================

import { defineJob } from "./runner.ts";
import { tickScheduler } from "../connectors/scheduler.ts";
import { sweepStoredPhotos } from "../connectors/photoSweep.ts";

export const CONNECTOR_JOBS = [
  defineJob({
    kind: "connectors.tick",
    every: 60_000,
    atStart: true,
    maxAttempts: 1,
    async run() {
      await tickScheduler();
    },
  }),
  defineJob({
    kind: "connectors.photoSweep",
    atStart: 5_000,
    async run() {
      await sweepStoredPhotos();
    },
  }),
];
