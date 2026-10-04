// =============================================================================
// Jobs: AI model catalogs
// =============================================================================
// The per-provider model lists the AI page offers, at start and every day
// after, so the dropdowns are filled on first open. Only providers whose
// cache is missing or older than its TTL are asked. Discovery is never on a
// critical path: a failure is recorded and the next day tries again.
// =============================================================================

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
