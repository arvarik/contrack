// The providers' model lists for the AI page, at start and every day after, so
// the dropdowns are filled on first open. Only providers whose cache is missing
// or past its TTL are asked. A failure is recorded and the next day tries
// again.

import { defineJob } from "./runner.ts";
import { refreshStaleModelCaches } from "../services/aiSettingsService.ts";

const DAY = 24 * 60 * 60 * 1000;

export const AI_JOBS = [
  defineJob({
    kind: "ai.modelCatalogs",
    every: DAY,
    atStart: true,
    async run() {
      await refreshStaleModelCaches();
    },
  }),
];
