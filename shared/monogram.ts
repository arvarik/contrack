/**
 * The monogram: one or two initials on a plain circle, as an SVG string.
 *
 * The server draws it for `GET /api/avatar/initials`, which is the account's
 * mark, and as the last fallback for every other style. The browser draws the
 * same SVG where it has no session to ask the server with: the photo circle
 * on the screens that create an account. The avatar route sits behind the
 * sign-in gate, so an `<img>` of it there got a 401 and showed a broken image.
 *
 * A hand-built string with no library, so drawing it cannot fail.
 *
 * @module shared/monogram
 */

/** Which palette the monogram is drawn for. */
export type MonogramTheme = "light" | "dark";

/** The two palettes' `surface-container` and `on-surface-variant`. */
const LIGHT = { bg: "#e8eff1", fg: "#566164" };
const DARK = { bg: "#1d2326", fg: "#b2bbbf" };

/** The first letter of the first two words, in capitals, or "?". */
export function monogramLetters(seed: string): string {
  return (
    seed
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * The monogram's SVG.
 *
 * With no `theme` the SVG decides for itself. An `<img>` cannot inherit the
 * page's palette, but it can carry its own media query, and that is the
 * correct answer for the default `system` theme. The colours are hard-coded
 * rather than read from a token, because the SVG shows as an image and no
 * page stylesheet reaches it.
 */
export function monogramSvg(seed: string, theme?: MonogramTheme): string {
  // Escape for XML: a name can legitimately contain & or <.
  const safe = monogramLetters(seed).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

  const style =
    theme === undefined
      ? `<style>:root{--bg:${LIGHT.bg};--fg:${LIGHT.fg}}` +
        `@media (prefers-color-scheme:dark){:root{--bg:${DARK.bg};--fg:${DARK.fg}}}</style>`
      : "";
  const picked = theme === "dark" ? DARK : LIGHT;
  const bg = theme === undefined ? "var(--bg)" : picked.bg;
  const fg = theme === undefined ? "var(--fg)" : picked.fg;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    style +
    `<rect width="100" height="100" fill="${bg}"/>` +
    `<text x="50" y="50" dy=".35em" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="42" font-weight="700" fill="${fg}">${safe}</text>` +
    `</svg>`
  );
}
