// =============================================================================
// Module: dashboard
// =============================================================================
// Pulse: the dashboard, its queue and its cards.
// =============================================================================

import { defineModule } from "../module.ts";
import { dashboardRouter } from "../../routes/dashboard.ts";
import { registerPulseTools } from "../../mcp/tools/pulse.ts";

export const dashboardModule = defineModule({
  id: "dashboard",
  routers: [{ path: "/api", router: dashboardRouter }],
  mcpTools: [
    ({ server, scope, onError }) => registerPulseTools(server, scope, onError),
  ],
});
