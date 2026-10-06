/**
 * The Pulse MCP tool: get_pulse.
 *
 * @module server/mcp/tools/pulse
 */

import type { McpToolContext } from "../../modules/module.ts";
import { dashboardService } from "../../services/dashboardService.ts";
import { answer, count } from "../tool.ts";

export function registerPulseTools({ tool, scope }: McpToolContext): void {
  tool("get_pulse", {}, () => {
    const pulse = dashboardService.getDashboardPayload(scope);
    return answer(
      `Pulse: ${count(pulse.metrics.totalActive, "active contact")}, ${pulse.tracking.count} tracked, ${pulse.tracking.catchUpCount} to catch up, ${count(pulse.overdue.length, "overdue follow-up")}`,
      { ...pulse },
    );
  });
}
