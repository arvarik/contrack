/**
 * Shared API client — base URL and a fetch wrapper with uniform error
 * handling for the app's REST endpoints.
 *
 * @module api/client
 */

export const API_BASE = "/api";

/**
 * Fetch `${API_BASE}${path}` and throw a descriptive Error on non-2xx.
 *
 * The error message is taken from the server's error envelope when present
 * (`{ error: { message } }` or `{ error: "..." }`), falling back to
 * `HTTP <status>` when the body isn't JSON or has no usable message.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
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
