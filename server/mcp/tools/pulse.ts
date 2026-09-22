/**
 * server/mcp/tools/pulse.ts — Pulse dashboard MCP tool.
 *
 * Implements:
 * - get_pulse
 *
 * @module server/mcp/tools/pulse
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import { dashboardService } from "../../services/dashboardService.ts";
import { MCP_TOOL_DESCRIPTIONS } from "../../../shared/mcpTools.ts";
import { trackedTool, type ErrorTracker } from "../errors.ts";

export function registerPulseTools(
  server: McpServer,
  scope: Scope,
  onError: ErrorTracker,
): void {
  server.registerTool(
    "get_pulse",
    {
      description: MCP_TOOL_DESCRIPTIONS.get_pulse,
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async () => {
      const pulse = dashboardService.getDashboardPayload(scope);
      return {
        content: [
          {
            type: "text" as const,
            text: `Pulse dashboard: ${pulse.metrics.totalActive} active contacts, ${pulse.tracking.count} tracked, ${pulse.tracking.catchUpCount} to catch up, ${pulse.overdue.length} overdue follow-ups`,
          },
        ],
        structuredContent: pulse,
      };
    }),
  );
}
