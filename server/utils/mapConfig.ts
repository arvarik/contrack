// Which basemap style each palette loads. By default OpenFreeMap's public
// vector styles: no API key, no registration, no request limits. An operator
// can point either palette at another style, self-hosted included:
//
//   MAP_STYLE_LIGHT  default https://tiles.openfreemap.org/styles/positron
//   MAP_STYLE_DARK   default https://tiles.openfreemap.org/styles/dark
//
// A value is an absolute https:// URL or a root-relative path such as
// /map/style.json (served from public/). Both GET /api/auth/status, which sends
// the URLs to the client, and the CSP, which allows their origins, read them
// here, so the two never drift apart.

import type { MapStyleUrls } from "../../shared/geo.ts";
import { log } from "./logger.ts";

export const DEFAULT_MAP_STYLE_LIGHT =
  "https://tiles.openfreemap.org/styles/positron";
export const DEFAULT_MAP_STYLE_DARK =
  "https://tiles.openfreemap.org/styles/dark";

/** A root-relative path: one leading slash, no whitespace, no backslash. */
const ROOT_RELATIVE = /^\/(?!\/)[^\s\\]*$/;

/**
 * The style URL a value names, or null. An absolute URL must be https with no
 * credentials, and comes back normalized. Its origin goes into a response
 * header, so anything the URL parser refuses is refused here, not escaped
 * there.
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
 * The style URL for each palette, read on every status request and every
 * response header, so the result is kept until the env values change, and an
 * invalid value warns once.
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
 * A style, its tiles, glyphs and sprite load through `fetch`; a root-relative
 * style is same-origin and adds nothing. A style can still name tiles on
 * another host; an operator adds that host here by serving the style from it,
 * or self-hosts the tiles too.
 */
export function styleOrigins(styles: MapStyleUrls = getMapStyles()): string[] {
  const origins = new Set<string>();
  for (const url of [styles.light, styles.dark]) {
    if (url.startsWith("/")) continue;
    origins.add(new URL(url).origin);
  }
  return [...origins];
}
