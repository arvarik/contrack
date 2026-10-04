/**
 * hostGuard — the DNS rebinding guard, and the Origin check of /api/mcp.
 *
 * With sign-in off, whoever reaches the server acts as the owner. A browser
 * keeps one site from reading another site's answers, but DNS rebinding gets
 * around that: a web page points its own name at this machine, and then reads
 * this server as if it were the same site. Each of its requests carries the
 * page's name in the Host header. So while sign-in is off, the server answers
 * only the names a public DNS name cannot be:
 * - an IP address, `localhost`, or a name with no dot (`nas`);
 * - a name under `.localhost`, `.local`, `.lan`, `.home.arpa` or `.internal`;
 * - the host of `PUBLIC_URL`, and the names in `ALLOWED_HOSTS`.
 *
 * With sign-in on, a rebinding page has no session and no token, so the
 * guard steps aside.
 *
 * @module server/middleware/hostGuard
 */

import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { isAuthRequired } from "./auth.ts";
import { AppError } from "../utils/AppError.ts";
import { publicOrigin } from "../utils/publicOrigin.ts";

/** Suffixes that public DNS never serves. */
const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".lan",
  ".home.arpa",
  ".internal",
];

/**
 * A host name as it is compared: lowercase, no port, no brackets, and no
 * final dot. `ALLOWED_HOSTS` entries go through it too, so an entry written
 * as a URL or with a port still matches. Null when it is not a host at all.
 */
function normalHost(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === "*" || value.startsWith(".")) return value.replace(/\.$/, "");
  try {
    const host = new URL(value.includes("://") ? value : `http://${value}`)
      .hostname;
    return host.replace(/^\[|\]$/g, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * The names `ALLOWED_HOSTS` adds, comma-separated, and the `PUBLIC_URL` host.
 * A name that starts with a dot allows every name under it. `*` turns the
 * guard off.
 */
function configuredHosts(): string[] {
  return [
    ...(process.env.ALLOWED_HOSTS ?? "").split(","),
    process.env.PUBLIC_URL ?? "",
  ]
    .map(normalHost)
    .filter((host): host is string => host !== null);
}

/** True when a page on the public internet cannot own this name. */
export function isHostAllowed(raw: string): boolean {
  const name = normalHost(raw);
  if (!name) return false;
  if (net.isIP(name) || !name.includes(".")) return true;
  if (LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return configuredHosts().some(
    (allowed) =>
      allowed === "*" ||
      allowed === name ||
      (allowed.startsWith(".") && name.endsWith(allowed)),
  );
}

export function hostGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isAuthRequired()) return next();
  // Both names must pass. `req.hostname` reads X-Forwarded-Host from a
  // trusted proxy hop, and a browser lets a page set that header itself, so
  // the raw Host header the browser wrote is checked as well.
  const names = [req.headers.host ?? "", req.hostname ?? ""];
  const refused = names.find((name) => !isHostAllowed(name));
  if (refused === undefined) return next();

  const message = `Contrack does not answer to "${refused || "a request with no host"}" while sign-in is off. Add the name to ALLOWED_HOSTS, or turn sign-in on with AUTH_REQUIRED=true.`;
  if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) {
    return next(new AppError(message, 403, { code: "HOST_NOT_ALLOWED" }));
  }
  res.status(403).type("text/plain").send(message);
}

/**
 * The MCP spec asks a server to refuse a request whose Origin it does not
 * know. An MCP client is not a web page and sends no Origin, so a request
 * with one came from a browser. It may come from this app's own origin, from
 * `PUBLIC_URL`, or from `CORS_ORIGIN`.
 */
export function mcpOriginGuard(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const origin = req.headers.origin;
  if (!origin) return next();
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  const known =
    (host !== null && host === req.host) ||
    origin === publicOrigin(req) ||
    origin === process.env.CORS_ORIGIN;
  if (known) return next();
  next(
    new AppError(
      `The MCP server does not accept requests from the web page at ${origin}. Set CORS_ORIGIN to that origin to allow it.`,
      403,
      { code: "ORIGIN_NOT_ALLOWED" },
    ),
  );
}
