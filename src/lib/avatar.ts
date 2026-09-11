/**
 * Shared avatar URL builders for the frontend.
 *
 * Both point at the app's own avatar route, which generates the SVG
 * in-process (see server/services/avatarService).
 *
 * This used to return an `api.dicebear.com` URL with the contact's name in the
 * query string, so rendering the contact list announced the name of every
 * person the user knows to a third party — and broke entirely offline. Same
 * artwork, same deterministic faces, no request leaving the machine.
 */

/** Styles the server accepts. A wrong one is a 400, not a blank image. */
type AvatarStyle = "avataaars" | "bottts" | "lorelei" | "initials";

/**
 * Which palette an avatar with a background of its own should be drawn for.
 *
 * Omitted means "let the image decide": the monogram carries its own
 * `prefers-color-scheme` rule, which is right for the default `system` theme
 * and needs no parameter. Pass a value only where the app knows the theme was
 * chosen explicitly, so an `<img>` cannot be left in the other palette.
 */
export type AvatarTheme = "light" | "dark";

/**
 * The seed the route will accept.
 *
 * An empty or whitespace seed is a `400 VALIDATION_ERROR`, which renders as a
 * broken image with no fallback. Callers pass a username or a display name and
 * either can be missing, so the substitution happens here rather than at six
 * call sites.
 */
function seedOf(value: string | null | undefined): string {
  const seed = (value ?? "").trim();
  return seed || "contrack";
}

function avatarUrl(
  style: AvatarStyle,
  seed: string | null | undefined,
  theme?: AvatarTheme,
): string {
  const suffix = theme ? `&theme=${theme}` : "";
  return `/api/avatar/${style}?seed=${encodeURIComponent(seedOf(seed))}${suffix}`;
}

/** A contact with no picture of their own. */
export function fallbackAvatarUrl(name: string): string {
  return avatarUrl("avataaars", name);
}

/**
 * The signed-in account's mark, in the sidebar and at the top of Settings.
 *
 * `initials` rather than the illustrated style contacts use, and seeded on the
 * username rather than the display name. Both are deliberate: the account is
 * not one of the contacts and should not look like one, and a username is the
 * stable identifier — a display name changes, and an avatar that changes with
 * it stops being recognisable.
 */
export function accountAvatarUrl(
  username: string | null | undefined,
  theme?: AvatarTheme,
): string {
  return avatarUrl("initials", username, theme);
}
