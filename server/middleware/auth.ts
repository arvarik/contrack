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
// Every request carries a Principal describing who is asking. As of Phase 0 of
// the 2.0 work, attachRequestContext turns that Principal into a Scope and
// every insert into an owned table stamps ownership from it. Reads are still
// unscoped: Phase 2 adds the owner predicate to each query. See
// docs/multi-tenant-plan/ and server/tenancy/scope.ts.
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
import {
  getUserById,
  resolveSession,
  type User,
} from "../services/authService.ts";
import { primaryAdminId, sqlite } from "../db.ts";

export const COOKIE_NAME = "contrack_session";

/** The legacy cookie, cleared on sight so old browsers don't hold a dead one. */
const LEGACY_COOKIE_NAME = "contrack_token";

// =============================================================================
// Principal
// =============================================================================

/**
 * Who is making this request.
 *
 * Every variant is a user. The `anonymous` and `service` kinds are gone: with
 * the local owner account there is always an account behind a request, so no
 * downstream code has to answer "which owner does a caller with no account
 * write for". `via` records how the caller proved who they are, which is what
 * requireSession gates on.
 */
export type Principal =
  /** Cookie `contrack_session`. The only kind that may manage the account. */
  | { kind: "user"; user: User; via: "session"; sessionId: string }
  /** `Authorization: Bearer ctk_...`, a personal token from `api_tokens`. */
  | { kind: "user"; user: User; via: "token"; tokenId: string }
  /** Auth is off. The local owner account, which nobody can sign in to. */
  | { kind: "user"; user: User; via: "implicit" }
  /** `Authorization: Bearer <env API_TOKEN>`, resolved to the primary admin. */
  | { kind: "user"; user: User; via: "legacy-env-token" };

// `Request.principal` is declared in server/types/express.d.ts, alongside the
// other Request augmentations, rather than here.

/**
 * The user behind this request.
 *
 * Returns null only when nothing authenticated the request at all, which
 * requireAuth has already refused for every gated route.
 */
export function currentUser(req: Request): User | null {
  return req.principal?.user ?? null;
}

/** The session id backing this request, or null for the other three kinds. */
export function currentSessionId(req: Request): string | null {
  return req.principal?.via === "session" ? req.principal.sessionId : null;
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

/**
 * Set when boot finds real accounts on an instance that asked for auth to be
 * off. Auth-off mode is only meaningful while the local owner is the only
 * account: with a second account there is no answer to "who is the caller with
 * no credential". See server/app.ts, which sets this.
 */
let forcedAuth = false;

export function setForcedAuth(value: boolean): void {
  forcedAuth = value;
}

/** True when the instance requires a credential. */
export function isAuthRequired(): boolean {
  return (
    forcedAuth ||
    process.env.AUTH_REQUIRED === "true" ||
    resolveApiToken() !== null
  );
}

/** Reset memoized warnings and the forced-auth latch. Test seam. */
export function __resetAuthWarnings(): void {
  legacyWarned = false;
  forcedAuth = false;
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
  const header = req.headers.authorization;
  const presented = header?.startsWith("Bearer ")
    ? header.slice(7).trim()
    : null;

  // 1. A personal token. Looked up by SHA-256 of the presented value against a
  //    unique index, so this is one probe and the plaintext is never stored.
  //    Phase 3 adds the endpoints that create these; the lookup exists now so
  //    the principal shape is final before Phase 2 scopes every read.
  if (presented?.startsWith("ctk_")) {
    const user = resolveApiTokenPrincipal(presented);
    if (user) {
      req.principal = {
        kind: "user",
        user: user.user,
        via: "token",
        tokenId: user.tokenId,
      };
      return next();
    }
  }

  // 2. The deprecated instance-wide env token. It has no account of its own,
  //    so it acts as the primary admin and is warned about once at boot.
  const apiToken = resolveApiToken();
  if (presented && apiToken && timingSafeEqualStrings(presented, apiToken)) {
    const admin = getUserById(primaryAdminId());
    if (admin && admin.status !== "disabled") {
      req.principal = { kind: "user", user: admin, via: "legacy-env-token" };
      return next();
    }
  }

  // 3. Session cookie. Resolved even when auth is off, so that someone who
  //    signed in before enforcement was disabled is still identified and their
  //    rows are stamped to them rather than to the local owner. Costs one
  //    indexed lookup, and only when a cookie is actually present.
  const secret = presentedSessionSecret(req);
  if (secret) {
    const resolved = resolveSession(secret);
    // Disabling an account ends its live sessions on the next request, which
    // is the whole point of a server-side session row.
    if (resolved && resolved.user.status !== "disabled") {
      req.principal = {
        kind: "user",
        user: resolved.user,
        via: "session",
        sessionId: resolved.sessionId,
      };
      return next();
    }
  }

  // 4. No credential on an ungated instance: the person at the keyboard is
  //    the local owner. This is what replaced the anonymous principal.
  if (!isAuthRequired()) {
    const owner = resolveLocalOwner();
    if (owner) {
      req.principal = { kind: "user", user: owner, via: "implicit" };
      return next();
    }
  }

  // Identified as nobody on a gated instance. Left unset rather than given a
  // principal, because "auth is off" and "you failed to authenticate" must not
  // look alike to anything downstream.
  next();
}

/**
 * Resolve a `ctk_` token to its user.
 *
 * Rejects a revoked token, an expired one, and one whose account is disabled.
 * `lastUsedAt` is stamped at most once an hour, matching how sessions treat
 * `lastSeenAt`: the write is not worth a page dirtied on every request.
 */
function resolveApiTokenPrincipal(
  token: string,
): { user: User; tokenId: string } | null {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const row = sqlite
    .prepare(
      `SELECT id, userId, lastUsedAt FROM api_tokens
        WHERE tokenHash = ? AND revokedAt IS NULL
          AND (expiresAt IS NULL OR expiresAt > datetime('now'))`,
    )
    .get(hash) as
    { id: string; userId: string; lastUsedAt: string | null } | undefined;
  if (!row) return null;

  const user = getUserById(row.userId);
  if (!user || user.status === "disabled") return null;

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  if (!row.lastUsedAt || row.lastUsedAt < hourAgo) {
    sqlite
      .prepare(
        `UPDATE api_tokens SET lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(row.id);
  }
  return { user, tokenId: row.id };
}

/**
 * The local owner account, read fresh on every request.
 *
 * The plan called for caching this row in memory. It is not cached, on
 * purpose. `users` holds a handful of rows on a self-hosted personal CRM, so
 * the scan is a single page and costs less than the session lookup above it.
 * A cache would need invalidating the moment setup converts this account into
 * a real one, and a stale entry there would hand the implicit principal an
 * identity the database no longer agrees with. Not worth one page read.
 */
const localOwnerStmt = sqlite.prepare(
  `SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`,
);

function resolveLocalOwner(): User | null {
  const row = localOwnerStmt.get() as { id: string } | undefined;
  return row ? getUserById(row.id) : null;
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
 * Gate for endpoints that act on the account itself — profile edits, password
 * changes, session management.
 *
 * Only a cookie session passes. A token proves which account it belongs to but
 * not that a person is present, so it must not be able to change the password
 * that would revoke it. The implicit local owner has no password to change.
 *
 * Renamed from requireUser in Phase 1, and its code changed from
 * USER_REQUIRED to SESSION_REQUIRED, because every principal is now a user and
 * the old name said the opposite of what the gate checks.
 */
export function requireSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.principal?.via === "session") return next();
  if (req.principal) {
    return next(
      new AppError(
        "This endpoint needs a signed-in session, not a token.",
        403,
        { code: "SESSION_REQUIRED" },
      ),
    );
  }
  next(new AppError("Authentication required", 401, { code: "UNAUTHORIZED" }));
}

/**
 * Gate for instance administration: user management, instance settings,
 * backups, the audit log.
 *
 * Mounted nowhere by design. Phase 2 classifies every admin route in
 * `ROUTE_MANIFEST` and stops there; Phase 3 mounts this guard and tests it.
 * A route test asserts it is absent until then.
 */
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.principal) {
    return next(
      new AppError("Authentication required", 401, { code: "UNAUTHORIZED" }),
    );
  }
  if (req.principal.user.role === "admin") return next();
  next(
    new AppError("This endpoint needs an admin account.", 403, {
      code: "ADMIN_REQUIRED",
    }),
  );
}
