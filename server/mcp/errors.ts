/**
 * server/mcp/errors.ts — How a failure reaches an MCP client.
 *
 * A tool that fails answers with a result marked `isError`, so the model
 * reads the reason and can try again (`toolFailure`). A prompt or a resource
 * has no such result, so its failure is a JSON-RPC error (`toMcpError`).
 *
 * @module server/mcp/errors
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";

/** What to do next, for the failures a model can recover from. */
const NEXT_STEP: Record<string, string> = {
  NOT_FOUND:
    "Look the ID up again with search_people, list_contacts or list_action_items. Do not guess an ID.",
};

export function toMcpError(err: unknown): unknown {
  if (err instanceof McpError) {
    return err;
  }
  if (err instanceof AppError) {
    return new McpError(
      err.statusCode === 400
        ? ErrorCode.InvalidParams
        : ErrorCode.InvalidRequest,
      err.message,
      {
        code: err.code,
        statusCode: err.statusCode,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    );
  }
  return err;
}

/**
 * A failed tool call as a result. A refusal the caller can act on (a 4xx
 * AppError) says why, with its code. Anything else is a fault in the server.
 * Its message can hold internals, so the client gets the request ID and the
 * log gets the cause.
 */
export function toolFailure(
  err: unknown,
  tool: string,
  requestId: string,
): CallToolResult {
  if (err instanceof AppError && err.statusCode < 500) {
    const next = NEXT_STEP[err.code];
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `${err.message} (${err.code}).${next ? ` ${next}` : ""}`,
        },
      ],
      structuredContent: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
    };
  }
  log.error("MCP", `[${requestId}] ${tool} failed`, {
    error: err instanceof Error ? err.message : String(err),
  });
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Contrack could not finish ${tool} (request ${requestId}). Try once more. If it fails again, the server log has the cause.`,
      },
    ],
  };
}
