/**
 * server/mcp/errors.ts — Error mapping between AppError and MCP JSON-RPC errors.
 *
 * Operational AppErrors are translated to McpError with code and details preserved
 * in the JSON-RPC error data payload.
 *
 * @module server/mcp/errors
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "../utils/AppError.ts";

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

export type ErrorTracker = (err: unknown) => void;

/**
 * Wraps a tool callback to capture any AppError thrown during execution
 * so the outer request handler can translate it into a JSON-RPC error.
 */
export function trackedTool<TArgs, TResult>(
  onError: ErrorTracker,
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    try {
      return await fn(args);
    } catch (err) {
      onError(err);
      throw toMcpError(err);
    }
  };
}
