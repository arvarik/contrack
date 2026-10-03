// =============================================================================
// Jobs: relationship scores
// =============================================================================
// Two sweeps, both per owner and both yielding between batches, so requests
// are never starved by a long scoring pass.
//
// The stale sweep reads `contacts.scoreDirty`, which triggers set, so it does
// work in proportion to what changed. It runs at start, when the first boot
// after an upgrade has marked every row, and every hour after. Each run then
// makes sure this week's score snapshot exists, which is a no-op once it
// does. The full sweep runs daily, because recency decays with the clock and
// no trigger can see that.
// =============================================================================

import { defineJob } from "./runner.ts";
import {
  ensureWeeklySnapshot,
  relationshipService,
} from "../services/relationshipService.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const SCORING_JOBS = [
  defineJob({
    kind: "scores.stale",
    every: HOUR,
    atStart: true,
    async run() {
      await relationshipService.recomputeStale();
      ensureWeeklySnapshot();
    },
  }),
  defineJob({
    kind: "scores.all",
    every: DAY,
    async run() {
      await relationshipService.recomputeAll();
    },
  }),
];
