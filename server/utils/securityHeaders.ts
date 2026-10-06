// The security headers every response carries, apart from app.ts so the
// policies can be read and tested without building the app. app.ts sets them in
// its first middleware.

import { styleOrigins } from "./mapConfig.ts";

/**
 * The Content-Security-Policy.
 *
 * The built index.html has no inline script, which allows a strict `script-src
 * 'self'`. Vite's dev server injects an inline React Refresh preamble and
 * reloads through a WebSocket on its own port, so dev mode adds
 * `'unsafe-inline'` to script-src and `ws:` to connect-src and keeps every
 * other directive. img-src stays open to https:, because imported contacts
 * carry avatar URLs on any host.
 *
 * connect-src names the external hosts the client fetches from: Open-Meteo for
 * the weather, and each basemap style's origin, from `mapConfig.ts`, which also
 * tells the client which style to load; MapLibre fetches a style, its tiles,
 * glyphs and sprite. MapLibre's tile worker is same-origin, `blob:` covers the
 * worker it builds from a blob when a worker URL is cross-origin, and
 * `child-src blob:` is the fallback older browsers read for worker-src.
 */
export function buildContentSecurityPolicy({
  origins = styleOrigins(),
  dev = false,
}: { origins?: readonly string[]; dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // MapLibre and React set style attributes
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "child-src blob:",
    [
      "connect-src 'self' https://api.open-meteo.com",
      ...(dev ? ["ws:"] : []),
      // A Set, because both palettes usually share one host and a directive
      // that names it twice says nothing the first mention did not.
      ...new Set(origins),
    ].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Browser features no page of this app uses, switched off for the page and
 * for anything it might embed. Passkeys, the clipboard and fullscreen keep
 * their default, which is this origin only.
 */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "display-capture=()",
  "browsing-topics=()",
].join(", ");

/**
 * HSTS for a year, only on a request that arrived over HTTPS (browsers ignore
 * it on plain HTTP). Behind a TLS proxy, `req.secure` is true only when
 * TRUST_PROXY_HOPS lets Express believe the proxy's X-Forwarded-Proto.
 */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000";
