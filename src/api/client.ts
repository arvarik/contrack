/**
 * Shared API client — base URL and a fetch wrapper with uniform error
 * handling for the app's REST endpoints.
 *
 * @module api/client
 */

import { emitAuthExpired } from "../lib/appEvents";

export const API_BASE = "/api";

/** A server rejection with its HTTP status, stable code, and request identifier. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Retry reads once for transient failures. Validation, authentication, and cancellation do not retry. */
export function retryApiQuery(failures: number, error: unknown): boolean {
  if (failures >= 1) return false;
  return (
    error instanceof NetworkError ||
    (error instanceof ApiError && error.status >= 500)
  );
}

/**
 * The server could not be reached at all — as opposed to reaching it and being
 * told no.
 *
 * These are completely different events for the user ("Contrack is down or
 * you are offline" vs "that contact does not exist") but `fetch` reports the
 * first as a bare `TypeError: Failed to fetch`, indistinguishable from a
 * programming error. Naming it lets one app-level sentinel recognise a
 * disconnection and speak for the whole app, instead of every view inventing
 * its own story about why it has no data.
 *
 * @see hooks/useConnectionStatus
 */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Can't reach the Contrack server.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

/** True when `error` is a failure to reach the server. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof NetworkError;
}

/**
 * Fetch `${API_BASE}${path}` and throw a descriptive Error on non-2xx.
 *
 * The error message is taken from the server's error envelope when present
 * (`{ error: { message } }` or `{ error: "..." }`), falling back to
 * `HTTP <status>` when the body isn't JSON or has no usable message.
 *
 * A transport failure throws {@link NetworkError} instead.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    // AbortError is a caller cancelling on purpose, not a dead server.
    if (
      init?.signal?.aborted ||
      (cause instanceof Error && cause.name === "AbortError")
    )
      throw cause;
    throw new NetworkError(cause);
  }
  if (!res.ok) {
    // A 401 anywhere means this browser's credential stopped being accepted —
    // the session expired, or was revoked from another device. Announced once,
    // globally, so AuthGate can put the sign-in screen back up; the error is
    // still thrown so the calling query fails the way it normally would.
    if (res.status === 401) emitAuthExpired();

    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    let requestId = res.headers.get("X-Request-Id") ?? undefined;
    try {
      const body = await res.json();
      const envelope = body?.error;
      if (typeof envelope === "string" && envelope) {
        message = envelope;
      } else if (envelope && typeof envelope.message === "string") {
        message = envelope.message;
        code = typeof envelope.code === "string" ? envelope.code : undefined;
        requestId =
          typeof envelope.requestId === "string"
            ? envelope.requestId
            : requestId;
        const issue = Array.isArray(envelope.details)
          ? envelope.details[0]
          : undefined;
        if (code === "VALIDATION_ERROR" && typeof issue?.message === "string")
          message = issue.message;
      } else if (typeof body?.message === "string" && body.message) {
        message = body.message;
      }
    } catch {
      // Body wasn't JSON — keep the HTTP status fallback.
    }
    const retryAfter = res.headers.get("Retry-After");
    const delay =
      retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : undefined;
    throw new ApiError(message, res.status, code, requestId, delay);
  }
  return res;
}
