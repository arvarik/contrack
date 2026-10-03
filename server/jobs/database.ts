// =============================================================================
// Jobs: the database
// =============================================================================
// Query-planner statistics, every day. SQLite recommends a periodic
// `PRAGMA optimize` for a connection that stays open for days: it runs
// ANALYZE only for tables whose shape drifted, so the common case is a no-op.
// Each drain of the search index runs it as well, and shutdown runs it too.
// =============================================================================

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
