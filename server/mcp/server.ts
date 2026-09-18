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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export function buildMcpServer(scope: Scope, req: Request): McpServer {
  const server = new McpServer({
    name: "contrack",
    version: "2.0.0",
  });

  let capturedError: unknown = null;
  const setCapturedError = (err: unknown) => {
    capturedError = err;
  };

  registerAllTools(server, scope, req, setCapturedError);
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
