/**
 * server/mcp/server.ts — McpServer factory per request.
 *
 * Each request to POST /api/mcp creates a fresh McpServer instance bound to the
 * caller's Scope and Request context. Tools call services directly; SQL is never
 * touched directly from an MCP tool.
 *
 * @module server/mcp/server
 */

import type { Request } from "express";
import {
  McpServer,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Scope } from "../tenancy/scope.ts";
import { registerAllTools } from "./tools/index.ts";
import { registerResources } from "./resources.ts";
import { registerPrompts } from "./prompts.ts";
import { AppError } from "../utils/AppError.ts";
import { MCP_TOOLS } from "../../shared/mcpTools.ts";

/**
 * What a client is told at `initialize`. A host puts this in front of its
 * model, so it says the few rules the tool descriptions cannot say alone.
 */
const INSTRUCTIONS = `Contrack is a personal CRM. Every tool acts as one account and sees only its data.
- Contact IDs come from search_people, list_contacts, or get_pulse. Do not guess an ID.
- Before create_contact, call list_contacts with the person's email or phone. create_contact refuses an email or phone that a contact already has.
- search_people ranks up to 30 matches for a question in plain words. To find every contact with a role, company, location, industry, tag, or list, use list_contacts.
- Write dates in ISO 8601. log_interaction takes a date that has already passed. A follow-up can be due on any date.
- To link the other people in a meeting or a note, pass their contact IDs in mentionContactIds.`;

const READ_ONLY_NOTE =
  "\n- This token is read-only. The server lists only the tools that change nothing.";

/**
 * Take out every tool that writes, for a read-only token.
 *
 * The SDK keeps its tools in a private map, as it keeps the request handlers
 * read below, and `remove()` is its public way to take one out. A tool that
 * MCP_TOOLS does not list as read-only goes too, so a new tool stays hidden
 * from a read-only token until it is listed there.
 */
function keepReadOnlyTools(server: McpServer): void {
  const reads = new Set(
    MCP_TOOLS.filter((tool) => tool.readOnly).map((tool) => tool.name),
  );
  const registered = (
    server as unknown as { _registeredTools: Record<string, RegisteredTool> }
  )._registeredTools;
  for (const [name, tool] of Object.entries(registered)) {
    if (!reads.has(name)) tool.remove();
  }
}

export function buildMcpServer(scope: Scope, req: Request): McpServer {
  const readOnly = req.principal?.via === "token" && req.principal.readOnly;
  const server = new McpServer(
    { name: "contrack", version: "2.0.0" },
    { instructions: readOnly ? INSTRUCTIONS + READ_ONLY_NOTE : INSTRUCTIONS },
  );

  let capturedError: unknown = null;
  const setCapturedError = (err: unknown) => {
    capturedError = err;
  };

  registerAllTools(server, scope, req, setCapturedError);
  if (readOnly) keepReadOnlyTools(server);
  registerResources(server, scope);
  registerPrompts(server, scope);

  // Hook into CallToolRequestSchema to translate internal AppError instances
  // directly to JSON-RPC error responses with matching error data code.
  const underlyingServer = server.server as unknown as {
    _requestHandlers: Map<
      string,
      (req: unknown, extra: unknown) => Promise<unknown>
    >;
  };
  const origHandler = underlyingServer._requestHandlers.get("tools/call");

  if (origHandler) {
    server.server.setRequestHandler(
      CallToolRequestSchema,
      async (callReq, extra) => {
        capturedError = null;
        const result = await origHandler(callReq, extra);

        if (capturedError instanceof AppError) {
          throw new McpError(
            capturedError.statusCode === 400
              ? ErrorCode.InvalidParams
              : ErrorCode.InvalidRequest,
            capturedError.message,
            {
              code: capturedError.code,
              statusCode: capturedError.statusCode,
              ...(capturedError.details !== undefined
                ? { details: capturedError.details }
                : {}),
            },
          );
        }

        return result as CallToolResult;
      },
    );
  }

  return server;
}
