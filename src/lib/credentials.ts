/**
 * One-time secrets, and how they are read.
 *
 * Three things in 2.0 exist exactly once: the invitation link an admin sends,
 * the temporary password they hand over, and a personal API token. Each is
 * shown on one screen, is never readable again, and travels from that screen
 * to a person by being copied, typed, or read aloud. The functions here are
 * the parts of that journey that are worth testing on their own.
 *
 * @module lib/credentials
 */

/** Where the accept-invitation screen lives, in the link the server builds. */
export const JOIN_PATH = "/join";

/** The query parameter carrying the invitation secret. */
export const JOIN_TOKEN_PARAM = "token";

/** Where password reset link lands. */
export const RESET_PASSWORD_PATH = "/reset-password";

/** Where magic link sign-in lands. */
export const SIGNIN_LINK_PATH = "/signin-link";

/**
 * Extract a query parameter secret from a specific path.
 */
export function parseUrlSecret(
  href: string,
  expectedPath: string,
  param: string,
): string | null {
  let url: URL;
  try {
    url = new URL(href, "http://invalid.localhost");
  } catch {
    return null;
  }
  if (url.pathname !== expectedPath) return null;
  const token = url.searchParams.get(param);
  return token && token.trim() ? token : null;
}

/**
 * Remove a query parameter secret from a specific path, rewriting it to root.
 */
export function urlWithoutSecret(
  href: string,
  expectedPath: string,
  param: string,
): string {
  let url: URL;
  try {
    url = new URL(href, "http://invalid.localhost");
  } catch {
    return "/";
  }
  url.searchParams.delete(param);
  const query = url.searchParams.toString();
  const path = url.pathname === expectedPath ? "/" : url.pathname;
  return `${path}${query ? `?${query}` : ""}${url.hash}`;
}

/**
 * The invitation secret in `href`, or null when there is not one.
 */
export function parseInvitationToken(href: string): string | null {
  return parseUrlSecret(href, JOIN_PATH, JOIN_TOKEN_PARAM);
}

/**
 * The same URL with the invitation secret removed.
 */
export function urlWithoutInvitationToken(href: string): string {
  return urlWithoutSecret(href, JOIN_PATH, JOIN_TOKEN_PARAM);
}

/**
 * Break a secret into groups a person can read without losing their place.
 *
 * A 20-character mixed-case password read down a phone line is where
 * transcription errors come from. Five groups of four is the same string with
 * somewhere for the eye to rest.
 *
 * The caller renders each group in its own element with a CSS gap, never a
 * space character: a space typed into a password field is a different
 * password, and a person who selects the text by hand must get the same
 * characters the copy button gives them.
 */
export function groupSecret(secret: string, size = 4): string[] {
  if (size < 1) return [secret];
  const groups: string[] = [];
  for (let i = 0; i < secret.length; i += size) {
    groups.push(secret.slice(i, i + size));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Reading secrets out of the address bar
// ---------------------------------------------------------------------------

/** Memoised by path + param so StrictMode remount gets the same answer. */
const takenSecrets = new Map<string, string | null>();

/**
 * Take a secret token out of the address bar, once.
 *
 * Memoised deliberately. React StrictMode mounts, unmounts and remounts every
 * component in development, and a second read would run after the first has
 * already stripped the URL.
 */
export function takeUrlSecret(path: string, param = "token"): string | null {
  const key = `${path}:${param}`;
  if (takenSecrets.has(key)) {
    return takenSecrets.get(key) ?? null;
  }
  if (typeof window === "undefined") return null;
  const href = window.location.href;
  const secret = parseUrlSecret(href, path, param);
  takenSecrets.set(key, secret);
  if (secret) {
    window.history.replaceState({}, "", urlWithoutSecret(href, path, param));
  }
  return secret;
}

/**
 * Take the invitation secret out of the address bar, once.
 */
export function takeInvitationToken(): string | null {
  return takeUrlSecret(JOIN_PATH, JOIN_TOKEN_PARAM);
}

/** Forget memoised reads. Test seam. */
export function __resetInvitationToken(): void {
  takenSecrets.clear();
}
