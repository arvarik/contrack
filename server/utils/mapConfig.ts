// =============================================================================
// Map config — which basemap style each palette loads
// =============================================================================
// The map draws OpenFreeMap's public vector styles by default: no API key, no
// registration, no request limits. An operator can point either palette at
// another style, a self-hosted one included, with two env vars:
//
//   MAP_STYLE_LIGHT  default https://tiles.openfreemap.org/styles/positron
//   MAP_STYLE_DARK   default https://tiles.openfreemap.org/styles/dark
//
// A value is an absolute https:// URL or a root-relative path such as
// /map/style.json, which is a style served from public/ by this app. This
// module is the one place both answers come from: GET /api/auth/status sends
// the URLs to the client, and the production CSP allows their origins. The
// style the client asks for and the origin the CSP allows therefore never
// drift apart.
// =============================================================================

import type { MapStyleUrls } from "../../shared/geo.ts";
import { log } from "./logger.ts";

export const DEFAULT_MAP_STYLE_LIGHT =
  "https://tiles.openfreemap.org/styles/positron";
export const DEFAULT_MAP_STYLE_DARK =
  "https://tiles.openfreemap.org/styles/dark";

/** A root-relative path: one leading slash, no whitespace, no backslash. */
const ROOT_RELATIVE = /^\/(?!\/)[^\s\\]*$/;

/**
 * The style URL a value names, or null when it names none.
 *
 * An absolute URL must be https and carry no credentials, and it comes back
 * normalised. Its origin goes into a response header, so anything the URL
 * parser does not accept is refused here rather than escaped there.
 */
export function parseStyleUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ROOT_RELATIVE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function pick(name: string, raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = parseStyleUrl(raw);
  if (parsed) return parsed;
  log.warn(
    "Map",
    `${name} is not an https:// URL or a root-relative path. Using the default basemap.`,
    { value: raw, default: fallback },
  );
  return fallback;
}

let cached: { key: string; styles: MapStyleUrls } | null = null;

/**
 * The style URL for each palette.
 *
 * Read on every status request and every response header, so the result is
 * kept until the env values change, and an invalid value warns once rather
 * than once per request.
 */
export function getMapStyles(
  env: NodeJS.ProcessEnv = process.env,
): MapStyleUrls {
  const key = `${env.MAP_STYLE_LIGHT ?? ""}\n${env.MAP_STYLE_DARK ?? ""}`;
  if (cached?.key === key) return cached.styles;
  const styles: MapStyleUrls = {
    light: pick(
      "MAP_STYLE_LIGHT",
      env.MAP_STYLE_LIGHT,
      DEFAULT_MAP_STYLE_LIGHT,
    ),
    dark: pick("MAP_STYLE_DARK", env.MAP_STYLE_DARK, DEFAULT_MAP_STYLE_DARK),
  };
  cached = { key, styles };
  return styles;
}

/**
 * The origins the CSP must allow in `connect-src` for these styles, each once.
 *
 * A style, its tiles, its glyphs and its sprite load through `fetch`. A
 * root-relative style is same-origin and adds nothing. A style can still name
 * tiles on another host, and an operator who does that adds the host here by
 * serving the style from it or by self-hosting the tiles too.
 */
export function styleOrigins(styles: MapStyleUrls = getMapStyles()): string[] {
  const origins = new Set<string>();
  for (const url of [styles.light, styles.dark]) {
    if (url.startsWith("/")) continue;
    origins.add(new URL(url).origin);
  }
  return [...origins];
}
