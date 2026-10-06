import type { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "./AppError.ts";
import { interactionSearchQuerySchema } from "../../shared/contracts/interactions.ts";
import { isValidTimeZone } from "../../shared/contracts/common.ts";

// The request schemas live in shared/contracts/, beside each route's answer,
// where the client, the MCP tools and the OpenAPI file read them too. This
// file holds the middleware and the readers that run them.

// ============================================================================
// Middleware Factories
// ============================================================================
//
// All three throw `ValidationError` (which the central error handler renders
// as a 400 with `code: "VALIDATION_ERROR"` and the Zod issue list as
// `details`). Routes therefore never reach into `res` from inside a
// validator — that responsibility belongs to the error middleware.

function runOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  where: "body" | "params" | "query",
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid request ${where}`, result.error.issues);
  }
  return result.data;
}

export const validateBody = (schema: z.ZodType) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = runOrThrow(schema, req.body, "body");
    next();
  };
};

/**
 * Read and validate a query string. Throws 400 on a bad one.
 *
 * A reader rather than a middleware: Express 5 makes `req.query` a getter,
 * so a parsed query cannot be put back on the request.
 */
export function parseQuery<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): z.output<S> {
  return runOrThrow(schema, raw, "query");
}

// ============================================================================
// Interaction search — GET /api/search/interactions and /api/interactions/search
// ============================================================================

type InteractionSearchQuery = z.output<typeof interactionSearchQuerySchema>;

/**
 * The reader's IANA zone from `?tz=`, when Intl knows it. Pulse, the badge
 * and the palette send it, so "today" is the reader's day. Without one, or
 * with one Intl does not know, the server's zone stands.
 */
export function readerTimeZone(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length <= 64 && isValidTimeZone(raw)
    ? raw
    : undefined;
}

/** Read and validate the query string of a note search. Throws 400 on a bad one. */
export function parseInteractionSearchQuery(
  raw: unknown,
): Omit<InteractionSearchQuery, "tz"> & { timeZone?: string } {
  const { tz, ...rest } = parseQuery(interactionSearchQuerySchema, raw);
  return { ...rest, timeZone: tz };
}
