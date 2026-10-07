// Query-planner statistics, daily. SQLite recommends a periodic `PRAGMA
// optimize` on a connection open for days; it runs ANALYZE only where a table's
// shape drifted. Every search index drain and shutdown run it too.

import { defineJob } from "./runner.ts";
import { refreshPlannerStats } from "../db.ts";

const DAY = 24 * 60 * 60 * 1000;

export const DATABASE_JOBS = [
  defineJob({
    kind: "database.plannerStats",
    every: DAY,
    run() {
      refreshPlannerStats();
    },
  }),
];
