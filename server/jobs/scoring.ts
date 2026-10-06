// Relationship score jobs. Both sweeps go owner by owner and yield between
// batches, so requests are never starved. The stale sweep reads
// `contacts.scoreDirty`, which triggers set, so its work follows what changed.
// It runs at start and every hour, and each run makes sure this week's score
// snapshot exists. The full sweep runs daily, because recency decays with the
// clock and no trigger sees that.

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
