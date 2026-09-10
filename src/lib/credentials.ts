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

/**
 * The invitation secret in `href`, or null when there is not one.
 *
 * Only `/join` counts. Any other path with a `token` in the query is some
 * other feature's parameter, and treating it as an invitation would drop a
 * signed-in user onto a create-an-account form for no reason.
 *
 * The base is a placeholder: `href` is expected to be absolute, and the base
 * only exists so a relative one still parses instead of throwing.
 */
export function parseInvitationToken(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, "http://invalid.localhost");
  } catch {
    return null;
  }
  if (url.pathname !== JOIN_PATH) return null;
  const token = url.searchParams.get(JOIN_TOKEN_PARAM);
  return token && token.trim() ? token : null;
}

/**
 * The same URL with the invitation secret removed.
 *
 * The secret is a credential sitting in the address bar, where it reaches the
 * browser history, the tab title, and a screenshot. It is removed as soon as
 * the app has read it, and the form keeps its own copy in component state
 * until it is submitted.
 *
 * Returns a path with the query and hash, which is what `history.replaceState`
 * takes.
 */
export function urlWithoutInvitationToken(href: string): string {
  let url: URL;
  try {
    url = new URL(href, "http://invalid.localhost");
  } catch {
    return "/";
  }
  url.searchParams.delete(JOIN_TOKEN_PARAM);
  const query = url.searchParams.toString();
  // Back to the root rather than to a bare `/join`, which is not a route the
  // app has: the gate renders the join screen instead of the router.
  const path = url.pathname === JOIN_PATH ? "/" : url.pathname;
  return `${path}${query ? `?${query}` : ""}${url.hash}`;
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
// Reading the invitation out of the address bar
// ---------------------------------------------------------------------------

/** Memoised so a second call — a StrictMode remount — gets the same answer. */
let taken: string | null | undefined;

/**
 * Take the invitation secret out of the address bar, once.
 *
 * Memoised deliberately. React StrictMode mounts, unmounts and remounts every
 * component in development, and a second read would run after the first has
 * already stripped the URL: the gate would capture the token, lose it, and
 * show an empty join form.
 */
export function takeInvitationToken(): string | null {
  if (taken !== undefined) return taken;
  const href = window.location.href;
  taken = parseInvitationToken(href);
  if (taken) {
    window.history.replaceState({}, "", urlWithoutInvitationToken(href));
  }
  return taken;
}

/** Forget the memoised read. Test seam — see {@link takeInvitationToken}. */
export function __resetInvitationToken(): void {
  taken = undefined;
}
