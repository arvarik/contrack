// =============================================================================
// Module: ai
// =============================================================================
// AI providers and models, their usage statistics, and the AI routes.
// /api/ai/stats mounts before /api/ai, as it always has. Its job refreshes
// the providers' model lists every day. At start, research turned off the
// old way, with the research model set to Off, moves to the "Allow web
// search" switch, which keeps a pinned model.
// =============================================================================

import { defineModule } from "../module.ts";
import { aiSettingsRouter } from "../../routes/aiSettings.ts";
import { aiStatsRouter } from "../../routes/aiStats.ts";
import { aiRouter } from "../../routes/ai.ts";
import { AI_JOBS } from "../../jobs/ai.ts";

export const aiModule = defineModule({
  id: "ai",
  routers: [
    { path: "/api/settings/ai", router: aiSettingsRouter },
    { path: "/api/ai/stats", router: aiStatsRouter },
    { path: "/api/ai", router: aiRouter },
  ],
  jobs: AI_JOBS,
});
