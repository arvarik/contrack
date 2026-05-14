/**
 * Centralized Express error middleware.
 *
 * Responsibilities:
 *  1. Translate every known thrown shape (AppError, ZodError, native Express
 *     parse error, SQLite errors) into a canonical JSON response.
 *  2. Carry `requestId` into the response body so the client can quote it
 *     when reporting an issue (it is already in the access log).
 *  3. Strip `stack` from the response in production. Always strip `cause`
 *     from the response — only the server log sees it.
 *  4. Distinguish operational errors (logged at info/warn) from unexpected
 *     errors (logged with the full stack at error level).
 *
 * Canonical error response shape:
 *   {
 *     error: { code: "NOT_FOUND", message: "Contact xyz not found",
 *              details?: any, requestId: "ab12cd34", stack?: "..." }
 *   }
 */
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";

interface SqliteLikeError {
  code?: string;
  message?: string;
  type?: string;
}

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
    stack?: string;
  };
}

function translate(err: unknown): {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  isOperational: boolean;
  cause?: unknown;
} {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      isOperational: err.isOperational,
      cause: (err as { cause?: unknown }).cause,
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid request payload",
      details: err.issues,
      isOperational: true,
    };
  }

  const e = err as SqliteLikeError;

  if (e?.type === "entity.parse.failed") {
    return {
      statusCode: 400,
      code: "INVALID_JSON",
      message: "Invalid JSON payload format",
      isOperational: true,
    };
  }

  if (e?.code === "SQLITE_CONSTRAINT") {
    return {
      statusCode: 400,
      code: "DB_CONSTRAINT",
      message: "Database constraint violation",
      details: { sqliteMessage: e.message },
      isOperational: true,
    };
  }

  if (e?.code === "SQLITE_BUSY") {
    return {
      statusCode: 503,
      code: "DB_BUSY",
      message: "Database is currently busy, please retry shortly",
      isOperational: true,
    };
  }

  if (e?.code === "SQLITE_READONLY") {
    return {
      statusCode: 503,
      code: "DB_READONLY",
      message: "Database is read-only",
      isOperational: true,
    };
  }

  // Unknown — treat as 500 / programmer error.
  return {
    statusCode: 500,
    code: "INTERNAL",
    message: "Internal Server Error",
    isOperational: false,
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // The 4-arg signature is required for Express to register this as the
  // error-handling middleware, even though we never call `next`.
  _next: NextFunction,
): void {
  const isProd = process.env.NODE_ENV === "production";
  const requestId = (req as Request & { requestId?: string }).requestId;
  const t = translate(err);

  if (!t.isOperational) {
    const stack = (err as Error)?.stack ?? String(err);
    log.error(
      "Unhandled",
      `[${requestId ?? "-"}] ${req.method} ${req.originalUrl} → ${t.statusCode} ${t.code}: ${stack}`,
    );
  } else {
    log.warn(
      "Operational",
      `[${requestId ?? "-"}] ${req.method} ${req.originalUrl} → ${t.statusCode} ${t.code}: ${t.message}`,
    );
    if (t.cause) {
      log.debug(
        "Operational",
        `[${requestId ?? "-"}] cause: ${String((t.cause as Error)?.message ?? t.cause)}`,
      );
    }
  }

  if (res.headersSent) {
    // The handler already started writing (e.g. SSE). We cannot send a JSON
    // error body now; the best we can do is destroy the connection so the
    // client knows the stream is dead.
    res.end();
    return;
  }

  const body: ErrorResponseBody = {
    error: {
      code: t.code,
      message: t.message,
      ...(requestId ? { requestId } : {}),
      ...(t.details !== undefined ? { details: t.details } : {}),
      ...(!isProd && (err as Error)?.stack
        ? { stack: (err as Error).stack }
        : {}),
    },
  };

  res.status(t.statusCode).json(body);
}

/**
 * 404 catch-all for unknown API routes. Mount this AFTER all route routers
 * but BEFORE the error middleware. Without it, unknown `/api/*` paths fall
 * through to the SPA index.html which is confusing for API clients.
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path.startsWith("/api/")) {
    return next(
      new AppError(`Unknown API endpoint: ${req.method} ${req.path}`, 404, {
        code: "ROUTE_NOT_FOUND",
      }),
    );
  }
  next();
}
