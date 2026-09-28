// =============================================================================
// The security headers every response carries
// =============================================================================
// Kept apart from app.ts so the policies can be read and tested without
// building the whole app. app.ts sets them in its first middleware.
// =============================================================================

import { styleOrigins } from "./mapConfig.ts";

/**
 * The Content-Security-Policy.
 *
 * The built index.html contains no inline script, which is what makes the
 * strict `script-src 'self'` possible. Vite's dev server is the one exception:
 * it injects an inline preamble for React Refresh and reloads through a
 * WebSocket on its own port, so dev mode adds `'unsafe-inline'` to script-src
 * and `ws:` to connect-src and keeps every other directive. The policy used to
 * be production-only, which left an instance run without NODE_ENV=production
 * with no policy at all. img-src stays open to https: because imported
 * contacts carry avatar URLs pointing at arbitrary hosts.
 *
 * connect-src names the external hosts the client fetches from: Open-Meteo
 * for the weather, and the origin of each basemap style. MapLibre loads a
 * style, its tiles, its glyphs and its sprite through `fetch`, and the
 * origins come from `mapConfig.ts`, the same module that tells the client
 * which style to load. MapLibre runs its tile work in a web worker: the
 * bundled worker file is same-origin, and `blob:` covers the worker MapLibre
 * builds from a blob when a worker URL is cross-origin. `child-src blob:` is
 * the fallback older browsers read in place of worker-src.
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
 * HSTS for a year, sent only on a request that arrived over HTTPS. Browsers
 * ignore the header on plain HTTP, and sending it there would say nothing.
 * Behind a TLS proxy, `req.secure` is true only when TRUST_PROXY_HOPS lets
 * Express believe the proxy's X-Forwarded-Proto.
 */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000";
