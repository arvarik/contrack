// The daily maintenance sweep of rows nothing else removes
// (maintenanceService), at start and every day after.

import { defineJob } from "./runner.ts";
import { runDailyMaintenance } from "../services/maintenanceService.ts";

const DAY = 24 * 60 * 60 * 1000;

export const MAINTENANCE_JOBS = [
  defineJob({
    kind: "maintenance.daily",
    every: DAY,
    atStart: true,
    run() {
      runDailyMaintenance();
    },
  }),
];
