/**
 * The shared API client. Every module in `src/api/` calls the server through
 * here, so one place turns a refusal into an `ApiError` and tells the app
 * when a session expires, an account is disabled or a password must change.
 * `tests/unit/frontend/api/client.test.ts` fails if a file here calls
 * `fetch` directly.
 */

import {
  emitAuthExpired,
  emitAuthStatusStale,
  emitPasswordChangeRequired,
} from "../lib/appEvents";
import { noteCorvidActivity } from "../lib/corvid";
import { noteRequest } from "../lib/idle";
import type { ResponseOf, RouteContract } from "../../shared/contracts/route";

export const API_BASE = "/api";

/** A server rejection with its HTTP status, stable code, and request identifier. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  /** The envelope's `details`, untouched. Shape depends on `code`. */
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    requestId?: string,
    retryAfterMs?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
    this.details = details;
  }

  /**
   * The server's wait in whole seconds, rounded up: a client that sleeps 0
   * seconds on a fractional wait retries into the same refusal.
   */
  get retryAfterSeconds(): number | undefined {
    if (this.retryAfterMs === undefined) return undefined;
    return Math.max(1, Math.ceil(this.retryAfterMs / 1000));
  }
}

/**
 * What a `429` was about. `yours === false` means another account holds a
 * lock or has spent the budget. Otherwise it is the caller's own limit.
 */
interface RateLimitFacts {
  /** False when another account holds the lock this request wanted. */
  yours: boolean;
  /** True when the server will start this work on its own once free. */
  queued: boolean;
  /** Seconds to wait, when the server named one. */
  retryAfterSeconds?: number;
}

/** The `429` facts of an error, or null for any other error. */
export function rateLimitFacts(error: unknown): RateLimitFacts | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const details = (error.details ?? {}) as {
    yours?: unknown;
    queued?: unknown;
    retryAfterSeconds?: unknown;
  };
  const fromBody =
    typeof details.retryAfterSeconds === "number"
      ? Math.max(1, Math.ceil(details.retryAfterSeconds))
      : undefined;
  return {
    // Absent means "yours": the per-account limiters and the AI cooldown do
    // not send the flag, and only the shared locks do.
    yours: details.yours !== false,
    queued: details.queued === true,
    retryAfterSeconds: fromBody ?? error.retryAfterSeconds,
  };
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
 * The server could not be reached at all, as opposed to answering no. `fetch`
 * reports this as a bare `TypeError`, so naming it lets one app-level check
 * (`hooks/useConnectionStatus`) speak for the whole app.
 */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Could not reach the server");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

/** True when `error` is a failure to reach the server. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof NetworkError;
}

/** Tells the app about a refusal that changes which screen it shows. */
function announce(status: number, code: string | undefined): void {
  if (status === 401) {
    // `INVALID_CREDENTIALS` is a wrong password typed into a form, not an
    // expiry: the session is fine. On the forced-change screen, treating it
    // as an expiry loops back to the same form.
    if (code === "INVALID_CREDENTIALS") return;
    emitAuthExpired("expired");
    return;
  }
  if (status !== 403) return;
  if (code === "ACCOUNT_DISABLED") {
    emitAuthExpired("disabled");
    return;
  }
  if (code === "PASSWORD_CHANGE_REQUIRED") {
    emitPasswordChangeRequired();
    return;
  }
  if (code === "ADMIN_REQUIRED") {
    // No toast: background polls would show it for requests nobody made,
    // and the caller's `onError` already shows the server's sentence. The
    // tab thinks this account is an admin and the server disagrees, so the
    // gate re-reads `/status` and `RequireAdmin` takes the screen away.
    emitAuthStatusStale();
  }
}

/**
 * Turns a non-2xx response into an {@link ApiError}, announcing it first. A
 * body with no usable message falls back to the status code, so the caller
 * never gets a parse failure in place of the server's answer.
 */
async function failureOf(res: Response): Promise<ApiError> {
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  let requestId = res.headers.get("X-Request-Id") ?? undefined;
  let details: unknown;
  try {
    const body = await res.json();
    const envelope = body?.error;
    if (typeof envelope === "string" && envelope) {
      // A plain string error. A few routes still answer with it.
      message = envelope;
    } else if (envelope && typeof envelope.message === "string") {
      message = envelope.message;
      code = typeof envelope.code === "string" ? envelope.code : undefined;
      requestId =
        typeof envelope.requestId === "string" ? envelope.requestId : requestId;
      details = envelope.details;
      const issue = Array.isArray(envelope.details)
        ? envelope.details[0]
        : undefined;
      if (code === "VALIDATION_ERROR" && typeof issue?.message === "string")
        message = issue.message;
    } else if (typeof body?.message === "string" && body.message) {
      message = body.message;
    }
  } catch {
    // Not JSON: keep the status fallback.
  }

  announce(res.status, code);

  const retryAfter = res.headers.get("Retry-After");
  const delay =
    retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : undefined;
  return new ApiError(message, res.status, code, requestId, delay, details);
}

/**
 * Fetches `${API_BASE}${path}`. Throws {@link ApiError} on non-2xx and
 * {@link NetworkError} when the server cannot be reached. Returns the
 * `Response`, for callers that want headers, a blob or a stream.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    // AbortError is a caller canceling on purpose, not a dead server.
    if (
      init?.signal?.aborted ||
      (cause instanceof Error && cause.name === "AbortError")
    )
      throw cause;
    throw new NetworkError(cause);
  }
  if (!res.ok) throw await failureOf(res);
  noteCorvidActivity(path);
  return res;
}

/** The parsed body of a success. A `204` or an empty body is `undefined`. */
async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * `apiFetch` and a JSON body in one call. Given a route's contract from
 * `shared/contracts/`, it sends the contract's method and types the answer by
 * its response. The answer is not parsed at runtime: the integration suite
 * checks that the server sends that shape. A route with no contract takes the
 * type it is given.
 */
export async function apiJson<C extends RouteContract>(
  contract: C,
  path: string,
  init?: Omit<RequestInit, "method">,
): Promise<ResponseOf<C>>;
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T>;
export async function apiJson(
  pathOrContract: string | RouteContract,
  pathOrInit?: string | RequestInit,
  init?: Omit<RequestInit, "method">,
): Promise<unknown> {
  const [path, request] =
    typeof pathOrContract === "string"
      ? [pathOrContract, pathOrInit as RequestInit | undefined]
      : [pathOrInit as string, { ...init, method: pathOrContract.method }];
  // Counted to the end of the body, where a list's bytes are, so idle
  // warm-ups wait for it (`lib/idle.ts`).
  return noteRequest(apiFetch(path, request).then(handleResponse));
}

/** A JSON request body, with the header the server needs to parse it. */
export function jsonBody(value: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
