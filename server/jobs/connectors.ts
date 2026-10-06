// Connector jobs. The scheduler tick, at start and every minute, starts the due
// syncs within the scheduler's limits (CONNECTOR_SYNC_CONCURRENCY, one
// connector per owner per tick) and returns; a failed tick is not retried,
// since the next is a minute away. The stored photo sweep runs once, five
// seconds after boot.

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
