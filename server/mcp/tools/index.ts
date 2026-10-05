/**
 * server/mcp/tools/index.ts — Registry aggregator for every MCP tool.
 *
 * Each feature module lists its tool groups (`mcpTools` in
 * server/modules/), and this registers every group of every module, in the
 * order of server/modules/index.ts. A new tool group is a line in its
 * module, not an edit here.
 *
 * @module server/mcp/tools
 */

import type { McpToolContext } from "../../modules/module.ts";
import { MODULES } from "../../modules/index.ts";

export function registerAllTools(context: McpToolContext): void {
  for (const feature of MODULES) {
    for (const register of feature.mcpTools) register(context);
  }
}
