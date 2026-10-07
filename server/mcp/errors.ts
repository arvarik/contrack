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

/** Where a model finds a real ID, by the kind of thing it did not find. */
const LOOK_UP: Record<string, string> = {
  Contact: "search_people or list_contacts",
  ActionItem: "list_action_items",
  List: "list_lists",
};

/** What to do next, for a failure a model can recover from. */
function nextStep(err: AppError): string {
  if (err.code !== "NOT_FOUND") return "";
  const entity = (err.details as { entity?: string } | undefined)?.entity;
  const tools =
    (entity && LOOK_UP[entity]) ??
    "search_people, list_contacts or list_action_items";
  return ` Look the ID up again with ${tools}. Do not guess an ID.`;
}

/** The spec's code for a resource that does not exist. */
const RESOURCE_NOT_FOUND = -32002;

/**
 * A JSON-RPC error as the SDK sends it: `code`, `message` and `data`. Not an
 * `McpError`, whose message already starts "MCP error -32600:", which the
 * client then puts in front a second time.
 */
function rpcError(code: number, message: string, data?: unknown): Error {
  return Object.assign(new Error(message), { code, data });
}

export function toMcpError(
  err: unknown,
  from: "prompt" | "resource" = "prompt",
): unknown {
  if (err instanceof McpError) {
    return err;
  }
  // A fault in the server can hold internals, such as SQL. The client gets
  // a plain message, and the log gets the cause.
  if (!(err instanceof AppError) || err.statusCode >= 500) {
    log.error("MCP", `A ${from} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return rpcError(
      ErrorCode.InternalError,
      "Contrack could not finish this. The server log has the cause.",
    );
  }
  const code =
    from === "resource" && err.code === "NOT_FOUND"
      ? RESOURCE_NOT_FOUND
      : err.statusCode === 400
        ? ErrorCode.InvalidParams
        : ErrorCode.InvalidRequest;
  return rpcError(code, err.message, {
    code: err.code,
    statusCode: err.statusCode,
    ...(err.details !== undefined ? { details: err.details } : {}),
  });
}

/**
 * A failed tool call as a result. A refusal the caller can act on (a 4xx
 * AppError) says why, with its code. Anything else is a server fault whose
 * message may hold internals, so the client gets the request ID and the log
 * gets the cause.
 */
export function toolFailure(
  err: unknown,
  tool: string,
  requestId: string,
): CallToolResult {
  if (err instanceof AppError && err.statusCode < 500) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          // "Not found (NOT_FOUND).", with no second period after a message
          // that already ends in one.
          text: `${err.message.replace(/\.$/, "")} (${err.code}).${nextStep(err)}`,
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
