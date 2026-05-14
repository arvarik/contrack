/**
 * AppError — application-level error class with machine-readable code,
 * structured `details`, and original-cause chaining.
 *
 * Design rules:
 * - Every operational error thrown from a service / repository MUST be an
 *   `AppError` (or one of its subclasses). Plain `throw new Error(...)` in
 *   the service layer is a code-review block — it surfaces as a generic 500
 *   and loses both the HTTP status and the machine-readable code.
 * - `statusCode` drives the HTTP response. `code` is the stable identifier
 *   the client can branch on (it never changes between versions). `message`
 *   is the human-readable string and IS allowed to change.
 * - `details` is an arbitrary structured blob — used by `ValidationError`
 *   to carry the Zod issue list, and by other subclasses to carry context.
 * - `cause` preserves the original error for log forensics without leaking
 *   the underlying stack to the client.
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

// =============================================================================
// Named Subclasses — preferred over passing magic numbers
// =============================================================================

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
