/**
 * The central Express error middleware:
 *   1. Turns every known thrown shape (AppError, ZodError, Express's parse
 *      error, SQLite errors) into one JSON shape.
 *   2. Puts `requestId` in the body, so the client can quote it (it is in the
 *      access log too).
 *   3. Leaves `stack` out in production and `cause` out always; only the
 *      server log sees them.
 *   4. Logs operational errors at info or warn, and unexpected ones with the
 *      full stack at error.
 *
 * The response shape:
 *   {
 *     error: { code: "NOT_FOUND", message: "Contact xyz not found",
 *              details?: any, requestId: "ab12cd34", stack?: "..." }
 *   }
 */
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { redactUrlForLog } from "../utils/helpers.ts";
import { recordBusyError } from "../services/walHealth.ts";

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

  if (e?.code === "LIMIT_FILE_SIZE")
    return {
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "The uploaded file exceeds the size limit",
      isOperational: true,
    };
  if (e?.code?.startsWith("LIMIT_"))
    return {
      statusCode: 400,
      code: "INVALID_UPLOAD",
      message: "Invalid upload fields",
      isOperational: true,
    };

  if (e?.type === "entity.parse.failed") {
    return {
      statusCode: 400,
      code: "INVALID_JSON",
      message: "Invalid JSON payload format",
      isOperational: true,
    };
  }

  // body-parser's over-limit rejection. Without this branch it fell into the
  // generic 500 with a full stack logged at error level — for a request the
  // server refused by policy, not a bug.
  if (e?.type === "entity.too.large") {
    return {
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the size limit for this endpoint",
      isOperational: true,
    };
  }

  if (e?.code?.startsWith("SQLITE_CONSTRAINT")) {
    return {
      statusCode: 400,
      code: "DB_CONSTRAINT",
      message: "Database constraint violation",
      // Raw SQLite text leaks table/column names — dev only.
      details:
        process.env.NODE_ENV !== "production"
          ? { sqliteMessage: e.message }
          : undefined,
      isOperational: true,
    };
  }

  if (
    e?.code?.startsWith("SQLITE_BUSY") ||
    e?.code?.startsWith("SQLITE_LOCKED")
  ) {
    // Counted here, the one place that knows a request was turned away rather
    // than waited out inside better-sqlite3's five second busy timeout. The
    // admin health panel shows the count, because one unlucky "try again" looks
    // like a pattern until somebody can see how many there were.
    recordBusyError();
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
      `[${requestId ?? "-"}] ${req.method} ${redactUrlForLog(req.originalUrl)} → ${t.statusCode} ${t.code}: ${stack}`,
    );
  } else {
    log.warn(
      "Operational",
      `[${requestId ?? "-"}] ${req.method} ${redactUrlForLog(req.originalUrl)} → ${t.statusCode} ${t.code}: ${t.message}`,
    );
    if (t.cause) {
      log.debug(
        "Operational",
        `[${requestId ?? "-"}] cause: ${String((t.cause as Error)?.message ?? t.cause)}`,
      );
    }
  }

  if (res.headersSent) {
    // The handler already started writing (SSE, say), so no JSON body can
    // follow: end the connection so the client knows the stream is dead.
    res.end();
    return;
  }

  // Every 429 that knows when to come back says so, and only here is the header
  // written. A limiter knows from its window; a queue lock only when it has an
  // estimate. The value travels in `details.retryAfterSeconds`, and a 429
  // without one sends no header rather than a guess a client would sleep on.
  if (t.statusCode === 429 && !res.getHeader("Retry-After")) {
    const seconds = (t.details as { retryAfterSeconds?: unknown } | undefined)
      ?.retryAfterSeconds;
    if (
      typeof seconds === "number" &&
      Number.isFinite(seconds) &&
      seconds > 0
    ) {
      res.setHeader("Retry-After", String(Math.ceil(seconds)));
    }
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
 * 404 for unknown API routes. Mount it after every router and before the error
 * middleware, or unknown `/api/*` paths fall through to the SPA's index.html.
 * `/.well-known/*` is for programs too: an MCP client looks there for the OAuth
 * metadata, and HTML in place of a 404 makes it fail on a parse error instead
 * of moving on.
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.path === "/api" ||
    req.path.startsWith("/api/") ||
    req.path.startsWith("/.well-known/")
  ) {
    return next(
      new AppError(`Unknown API endpoint: ${req.method} ${req.path}`, 404, {
        code: "ROUTE_NOT_FOUND",
      }),
    );
  }
  next();
}
