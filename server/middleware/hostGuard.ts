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
 * The names `ALLOWED_HOSTS` adds, comma-separated. A name that starts with a
 * dot allows every name under it. `*` turns the guard off.
 */
function configuredHosts(): string[] {
  const hosts = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const publicUrl = process.env.PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      hosts.push(new URL(publicUrl).hostname.toLowerCase());
    } catch {
      // createApp refuses a bad PUBLIC_URL at boot.
    }
  }
  return hosts;
}

/** True when a page on the public internet cannot own this name. */
export function isHostAllowed(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, "");
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
  // `req.hostname` reads X-Forwarded-Host only from a trusted proxy hop.
  const hostname = req.hostname;
  if (hostname && isHostAllowed(hostname)) return next();

  const message = `Contrack does not answer to "${hostname}" while sign-in is off. Add the name to ALLOWED_HOSTS, or turn sign-in on with AUTH_REQUIRED=true.`;
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
