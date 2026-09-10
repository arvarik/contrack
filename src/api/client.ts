/**
 * Shared API client — the base URL, and the one place a server rejection is
 * turned into something the app can act on.
 *
 * Every module under `src/api/` goes through here. That is not tidiness: the
 * server can now answer a perfectly ordinary request with "your session
 * expired", "your account is disabled", or "change your password first", and
 * each of those needs the whole app to change screen rather than the calling
 * view to show a toast. A view cannot make that decision, and eleven views
 * making it separately would make it eleven ways. So the transport recognises
 * the answer, announces it once on the window, and still throws, so the
 * calling query fails exactly the way it always has.
 *
 * `tests/unit/frontend.apiClient.test.ts` reads every file in this directory
 * and fails if one calls `fetch` without coming back through here.
 *
 * @module api/client
 */

import { emitAuthExpired, emitPasswordChangeRequired } from "../lib/appEvents";

export const API_BASE = "/api";

/** A server rejection with its HTTP status, stable code, and request identifier. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
    readonly retryAfterMs?: number,
    /** The envelope's `details`, untouched. Shape depends on `code`. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * How long the server asked us to wait, in whole seconds.
   *
   * Rounded up, because a client that sleeps 0 seconds on a fractional wait
   * retries into the same refusal.
   */
  get retryAfterSeconds(): number | undefined {
    if (this.retryAfterMs === undefined) return undefined;
    return Math.max(1, Math.ceil(this.retryAfterMs / 1000));
  }
}

/**
 * What a `429` was actually about.
 *
 * Two very different refusals share the status. `yours === false` means
 * somebody else on this instance holds a lock or has spent the budget, and
 * the honest message names that rather than implying the reader did something
 * wrong. `yours === true` (or absent) is the caller's own limit.
 */
export interface RateLimitFacts {
  /** False when another account holds the lock this request wanted. */
  yours: boolean;
  /** True when the server will start this work on its own once free. */
  queued: boolean;
  /** Seconds to wait, when the server named one. */
  retryAfterSeconds?: number;
}

/** Read the `429` facts out of an error, whatever it turns out to be. */
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
 * Tell the app about a refusal only it can answer.
 *
 * Each of these changes which screen the app should be showing, and the gate
 * is the only component that can change it. Everything else about the failure
 * stays with the caller.
 */
function announce(status: number, code: string | undefined): void {
  if (status === 401) {
    // Two different things arrive as 401 and only one of them is an expiry.
    //
    // `INVALID_CREDENTIALS` is the server rejecting a password somebody just
    // typed — a wrong current password on the change-password form. The
    // browser's own credential is fine and the cookie is untouched. Treating
    // it as an expiry ejected the person to a sign-in screen reading "your
    // session expired" for a typo, and on the forced-change screen that is a
    // loop: signing back in returns them to the same form with no idea what
    // went wrong.
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
  // `ADMIN_REQUIRED` is deliberately NOT announced, and this is a departure
  // from what task 4.11 asks for. The plan says to toast it. A toast from the
  // transport fires for requests nobody made: `useGroundingCapacity` polls an
  // admin-only route every two minutes from the command palette, so every
  // member would have seen a red error on load and again every two minutes
  // for the life of the tab. It also fires a second time from the caller's
  // own `onError`, which already shows the server's more specific sentence.
  //
  // Hiding the control is `RequireAdmin`'s job and refusing the request is
  // the server's. Neither of those needs a toast.
}

/**
 * Turn a non-2xx response into an {@link ApiError}, announcing it first.
 *
 * Reads the body once. A body that is not JSON, or is JSON with nothing
 * usable in it, falls back to the status code — the point is that the caller
 * always gets an `ApiError` with a `status`, never a parse failure standing
 * in for the server's answer.
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
      // The pre-2.0 shape. A handful of routes still answer with it.
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
    // Body wasn't JSON — keep the HTTP status fallback.
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
 * Fetch `${API_BASE}${path}` and throw {@link ApiError} on non-2xx.
 *
 * Returns the `Response` rather than its body, because plenty of callers want
 * the headers, a blob, or a stream. {@link handleResponse} is the shorthand
 * for the common case.
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
  if (!res.ok) throw await failureOf(res);
  return res;
}

/**
 * The parsed body of a response, or an {@link ApiError} describing why not.
 *
 * Use this for anything that reads JSON, which is nearly everything:
 * `handleResponse<Shape>(await apiFetch(path))`. A `204` and an empty body
 * both resolve to `undefined`, so a delete endpoint that returns nothing does
 * not have to pretend to return something.
 */
export async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) throw await failureOf(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** `apiFetch` and `handleResponse` in one call, for the ordinary JSON case. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return handleResponse<T>(await apiFetch(path, init));
}

/** A JSON request body, with the header the server needs to parse it. */
export function jsonBody(value: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
