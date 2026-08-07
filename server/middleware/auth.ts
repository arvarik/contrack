// =============================================================================
// Authentication — accounts for people, tokens for machines
// =============================================================================
// Two credential kinds, because they are used by different things and want
// different properties:
//
//   • A SESSION belongs to a person. Username/email + password at a sign-in
//     screen, exchanged for an HttpOnly cookie backed by a server-side row so
//     it can actually be revoked.
//
//   • An API TOKEN belongs to a script. High-entropy, sent as
//     `Authorization: Bearer <token>`, never expires, no login round-trip.
//     MCP clients and cron jobs want this; making them drive a password form
//     would be strictly worse.
//
// Enforcement is controlled by AUTH_REQUIRED (default false — see the note on
// binding below). API_TOKEN also implies enforcement, because a token is only
// meaningful on an instance that is gated.
//
// Every request carries a Principal describing who is asking. Today nothing
// downstream filters by it beyond "are you allowed in at all", but it is the
// seam multi-tenancy needs, and stamping ownership on new rows already uses it.
//
// Note on defaults: auth is off out of the box, including in Docker, because
// the common case is a container reached only from its host. The server logs a
// warning at startup when it binds a non-loopback address with auth off, which
// is the case where that default is wrong.
// =============================================================================

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { log } from "../utils/logger.ts";
import { AppError } from "../utils/AppError.ts";
import { resolveSession, type User } from "../services/authService.ts";

export const COOKIE_NAME = "contrack_session";

/** The legacy cookie, cleared on sight so old browsers don't hold a dead one. */
const LEGACY_COOKIE_NAME = "contrack_token";

// =============================================================================
// Principal
// =============================================================================

/** Who is making this request. */
export type Principal =
  /** Auth is disabled — everyone is let through, nobody is identified. */
  | { kind: "anonymous" }
  /** A signed-in person. */
  | { kind: "user"; user: User; sessionId: string }
  /** A script or MCP client presenting API_TOKEN. */
  | { kind: "service" };

// `Request.principal` is declared in server/types/express.d.ts, alongside the
// other Request augmentations, rather than here.

/** The signed-in user, or null for anonymous/service requests. */
export function currentUser(req: Request): User | null {
  return req.principal?.kind === "user" ? req.principal.user : null;
}

/** The session id backing this request, or null. */
export function currentSessionId(req: Request): string | null {
  return req.principal?.kind === "user" ? req.principal.sessionId : null;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * The machine token, or null when none is configured.
 *
 * Read per call rather than cached at import so tests can toggle enforcement
 * by setting the environment variable.
 */
export function resolveApiToken(): string | null {
  const token = process.env.API_TOKEN?.trim();
  if (token) return token;

  // AUTH_TOKEN was this variable's name before accounts existed, when it was
  // the only credential. Still honoured so an existing deployment does not
  // break on upgrade; warned about once so it eventually goes away.
  const legacy = process.env.AUTH_TOKEN?.trim();
  if (legacy) {
    warnLegacyTokenOnce();
    return legacy;
  }
  return null;
}

let legacyWarned = false;
function warnLegacyTokenOnce(): void {
  if (legacyWarned) return;
  legacyWarned = true;
  log.warn(
    "Auth",
    "AUTH_TOKEN is deprecated — rename it to API_TOKEN. It now identifies machine clients (scripts, MCP); people sign in with an account.",
  );
}

/** True when the instance requires a credential. */
export function isAuthRequired(): boolean {
  return process.env.AUTH_REQUIRED === "true" || resolveApiToken() !== null;
}

/** Reset memoized warnings. Test seam. */
export function __resetAuthWarnings(): void {
  legacyWarned = false;
}

// =============================================================================
// Cookie handling
// =============================================================================

/** Minimal cookie parser (avoids a dependency for two cookies). */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Cookie attributes.
 *
 * `SameSite=Strict` is the CSRF defence for the cookie path — a cross-site
 * request simply does not carry the cookie, so no state-changing endpoint can
 * be triggered from another origin.
 *
 * `Secure` is set only when the request arrived over HTTPS. Hard-coding it
 * would break plain-HTTP local use (`http://localhost:3210`), which is the
 * default way this app is run; omitting it entirely would drop the flag on
 * the reverse-proxy deployments where it matters most.
 */
function cookieAttributes(req: Request, maxAgeSeconds: number): string {
  const secure = isHttps(req) ? "; Secure" : "";
  return `HttpOnly; SameSite=Strict; Path=/${secure}; Max-Age=${maxAgeSeconds}`;
}

function isHttps(req: Request): boolean {
  if (req.secure) return true;
  // Behind a reverse proxy Express only sees plain HTTP; the proxy reports the
  // original scheme in this header. Trusted for the sole purpose of deciding
  // whether to add `Secure`, where a wrong answer costs nothing an attacker
  // could not already do on a plain-HTTP connection.
  const forwarded = req.headers["x-forwarded-proto"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return typeof value === "string" && value.split(",")[0].trim() === "https";
}

/** Set the session cookie on a response. */
export function setSessionCookie(
  req: Request,
  res: Response,
  secret: string,
  expiresAt: string,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(secret)}; ${cookieAttributes(req, maxAge)}`,
  );
}

/** Clear the session cookie, and the pre-accounts one alongside it. */
export function clearSessionCookie(req: Request, res: Response): void {
  res.append("Set-Cookie", `${COOKIE_NAME}=; ${cookieAttributes(req, 0)}`);
  res.append(
    "Set-Cookie",
    `${LEGACY_COOKIE_NAME}=; ${cookieAttributes(req, 0)}`,
  );
}

/** Read the session secret this request presented, if any. */
export function presentedSessionSecret(req: Request): string | null {
  return readCookie(req, COOKIE_NAME);
}

// =============================================================================
// Middleware
// =============================================================================

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolve the caller and hang it on the request. Runs for every request,
 * including the pre-auth ones, so `/api/auth/status` can report who you are.
 *
 * Never rejects — deciding what to do about an unidentified caller is
 * `requireAuth`'s job, and the auth routes need to run without one.
 */
export function attachPrincipal(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Bearer token → service client.
  const header = req.headers.authorization;
  const apiToken = resolveApiToken();
  if (header?.startsWith("Bearer ") && apiToken) {
    const presented = header.slice(7).trim();
    if (timingSafeEqualStrings(presented, apiToken)) {
      req.principal = { kind: "service" };
      return next();
    }
  }

  // Session cookie → person. Resolved even when auth is off, so that someone
  // who signed in before enforcement was disabled is still *identified* —
  // which is what stamps ownership on the rows they create and what makes
  // /api/auth/me answer. Costs one indexed lookup, and only when a cookie is
  // actually present.
  const secret = presentedSessionSecret(req);
  if (secret) {
    const resolved = resolveSession(secret);
    if (resolved) {
      req.principal = {
        kind: "user",
        user: resolved.user,
        sessionId: resolved.sessionId,
      };
      return next();
    }
  }

  if (!isAuthRequired()) {
    req.principal = { kind: "anonymous" };
    return next();
  }

  // Identified as nobody on a gated instance. Left unset rather than marked
  // anonymous, because "auth is off" and "you failed to authenticate" must not
  // look alike to anything downstream.
  next();
}

/** True when this request may proceed. */
export function isAuthenticated(req: Request): boolean {
  return req.principal !== undefined;
}

/**
 * Gate for /api/* and /uploads/*. No-op when auth is disabled.
 *
 * The /api/auth/* endpoints are mounted BEFORE this in app.ts so sign-in and
 * status stay reachable.
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isAuthenticated(req)) return next();
  next(new AppError("Authentication required", 401, { code: "UNAUTHORIZED" }));
}

/**
 * Gate for endpoints that need a person rather than any valid credential —
 * profile edits, password changes, session management. A service token is a
 * shared secret with no account behind it, so there is no "your password" for
 * it to change.
 */
export function requireUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.principal?.kind === "user") return next();
  if (req.principal?.kind === "service") {
    return next(
      new AppError(
        "This endpoint needs a signed-in account, not an API token.",
        403,
        { code: "USER_REQUIRED" },
      ),
    );
  }
  next(new AppError("Authentication required", 401, { code: "UNAUTHORIZED" }));
}
