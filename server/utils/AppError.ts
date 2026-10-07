/**
 * An application error with a machine-readable code, structured `details` and a
 * chained cause.
 * - Every operational error a service or repository throws is an `AppError` (or
 *   a subclass). A plain `Error` surfaces as a generic 500 and loses the status
 *   and the code.
 * - `statusCode` drives the HTTP response. `code` is the stable identifier a
 *   client branches on; `message` is for people and may change.
 * - `details` carries structured context, such as `ValidationError`'s Zod
 *   issues.
 * - `cause` keeps the original error for the log without sending its stack to
 *   the client.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    options: {
      code?: string;
      details?: unknown;
      cause?: unknown;
      isOperational?: boolean;
    } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = options.isOperational ?? true;
    this.code = options.code ?? defaultCodeForStatus(statusCode);
    this.details = options.details;
    if (options.cause !== undefined) {
      // `Error.cause` is supported in Node 16.9+. Set defensively.
      (this as { cause?: unknown }).cause = options.cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE";
    case 429:
      return "RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    case 504:
      return "TIMEOUT";
    default:
      return status >= 500 ? "INTERNAL" : "ERROR";
  }
}

// Named Subclasses — preferred over passing magic numbers

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} ${id} not found` : `${entity} not found`, 404, {
      code: "NOT_FOUND",
      details: { entity, id },
    });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, { code: "VALIDATION_ERROR", details });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, { code: "CONFLICT", details });
  }
}

export class RateLimitedError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 429, { code: "RATE_LIMITED", details });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 503, { code: "SERVICE_UNAVAILABLE", details });
  }
}

export class UpstreamTimeoutError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 504, { code: "UPSTREAM_TIMEOUT", details });
  }
}
