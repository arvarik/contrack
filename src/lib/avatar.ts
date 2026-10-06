/**
 * Shared avatar URL builders for the frontend.
 *
 * They point at the app's own avatar route, which generates the SVG
 * in-process (see server/services/avatarService). The one exception is
 * `signedOutAccountAvatarUrl`, which draws the monogram in the browser. So
 * drawing a list of contacts sends no name to a third party, and works
 * offline.
 */
import { monogramSvg } from "../../shared/monogram";

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
type AvatarTheme = "light" | "dark";

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
 * True when the avatar is drawn by the app and not a photo of the person: no
 * URL at all draws the fallback, and the app's own route draws the rest.
 */
export function isGeneratedAvatar(url: string | null | undefined): boolean {
  return !url || url.startsWith("/api/avatar/");
}

/**
 * The signed-in account's mark, in the sidebar and at the top of Settings.
 *
 * `initials` rather than the illustrated style contacts use, and seeded on the
 * username rather than the display name. Both are deliberate: the account is
 * not one of the contacts and should not look like one, and a username is the
 * stable identifier — a display name changes, and an avatar that changes with
 * it stops being recognizable.
 */
export function accountAvatarUrl(
  username: string | null | undefined,
  theme?: AvatarTheme,
): string {
  return avatarUrl("initials", username, theme);
}

/**
 * The account's mark before the account exists: on the screens that create
 * one (first-run setup, register, join an invitation).
 *
 * `accountAvatarUrl` points at `/api/avatar/initials`, and that route sits
 * behind the sign-in gate. With no session yet, the `<img>` got a 401 and
 * showed a broken image in the photo circle. This is the same monogram, drawn
 * here by `shared/monogram.ts` as a `data:` URL, which the CSP allows for
 * images, so the circle needs no request at all.
 */
export function signedOutAccountAvatarUrl(
  username: string | null | undefined,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    monogramSvg(seedOf(username)),
  )}`;
}
