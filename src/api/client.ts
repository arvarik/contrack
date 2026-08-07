/**
 * Shared API client — base URL and a fetch wrapper with uniform error
 * handling for the app's REST endpoints.
 *
 * @module api/client
 */

import { emitAuthExpired } from "../lib/appEvents";

export const API_BASE = "/api";

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
    if (cause instanceof DOMException && cause.name === "AbortError")
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
    try {
      const body = await res.json();
      const envelope = body?.error;
      if (typeof envelope === "string" && envelope) {
        message = envelope;
      } else if (envelope && typeof envelope.message === "string") {
        message = envelope.message;
      } else if (typeof body?.message === "string" && body.message) {
        message = body.message;
      }
    } catch {
      // Body wasn't JSON — keep the HTTP status fallback.
    }
    throw new Error(message);
  }
  return res;
}
