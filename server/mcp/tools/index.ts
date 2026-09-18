/**
 * server/mcp/tools/index.ts — Registry aggregator for all 15 MCP tools.
 *
 * @module server/mcp/tools
 */

import type { Request } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import type { ErrorTracker } from "../errors.ts";
import { registerContactTools } from "./contacts.ts";
import { registerSearchTools } from "./search.ts";
import { registerInteractionTools } from "./interactions.ts";
import { registerActionItemTools } from "./actions.ts";
import { registerPulseTools } from "./pulse.ts";
import { registerTaxonomyTools } from "./taxonomy.ts";

export function registerAllTools(
  server: McpServer,
  scope: Scope,
  req: Request,
  onError: ErrorTracker,
): void {
  registerContactTools(server, scope, onError);
  registerSearchTools(server, scope, req, onError);
  registerInteractionTools(server, scope, onError);
  registerActionItemTools(server, scope, onError);
  registerPulseTools(server, scope, onError);
  registerTaxonomyTools(server, scope, onError);
}
