/**
 * Avatar URLs. They point at the app's own avatar route, which draws the SVG
 * in-process, so a list of contacts sends no name to a third party.
 */
import { monogramSvg } from "../../shared/monogram";

/** Styles the server accepts. A wrong one is a 400, not a blank image. */
type AvatarStyle = "avataaars" | "bottts" | "lorelei" | "initials";

/**
 * The palette an avatar with its own background is drawn for. Omitted, the
 * monogram follows `prefers-color-scheme`, which suits the `system` theme.
 * Pass one only when the theme was chosen explicitly.
 */
type AvatarTheme = "light" | "dark";

/**
 * A seed the route accepts. An empty seed is a 400, which renders as a
 * broken image, and a username or display name can be missing.
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
 * The signed-in account's mark. `initials`, so the account does not look
 * like a contact, and seeded on the username, which does not change as a
 * display name can.
 */
export function accountAvatarUrl(
  username: string | null | undefined,
  theme?: AvatarTheme,
): string {
  return avatarUrl("initials", username, theme);
}

/**
 * The account's mark on the screens that create an account, before any
 * session exists. The avatar route sits behind the sign-in gate, so this
 * draws the same monogram as a `data:` URL, which the CSP allows.
 */
export function signedOutAccountAvatarUrl(
  username: string | null | undefined,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    monogramSvg(seedOf(username)),
  )}`;
}
