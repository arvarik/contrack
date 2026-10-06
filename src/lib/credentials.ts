/**
 * One-time secrets: an invitation link, a temporary password, a personal API
 * token, and the secrets in a reset or sign-in link. Each is shown once and
 * reaches a person by being copied, typed or read aloud.
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
 * Break a secret into groups of four, so a person reading it aloud does not
 * lose their place. The caller renders each group in its own element with a
 * CSS gap, never a space: text selected by hand must match what the copy
 * button gives.
 */
export function groupSecret(secret: string, size = 4): string[] {
  if (size < 1) return [secret];
  const groups: string[] = [];
  for (let i = 0; i < secret.length; i += size) {
    groups.push(secret.slice(i, i + size));
  }
  return groups;
}

/** By path and param, so a StrictMode remount gets the same answer. */
const takenSecrets = new Map<string, string | null>();

/**
 * Take a secret out of the address bar, once. Memoized, because StrictMode
 * remounts in development, and a second read would find the URL stripped.
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

/** Take the invitation secret out of the address bar, once. */
export function takeInvitationToken(): string | null {
  return takeUrlSecret(JOIN_PATH, JOIN_TOKEN_PARAM);
}
