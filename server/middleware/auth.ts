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
// binding below).
//
// Every request carries a Principal describing who is asking. attachRequestContext
// turns that Principal into a Scope and queries/mutations on owned tables
// enforce ownership from it. See server/tenancy/scope.ts.
//
// Note on defaults: auth is off out of the box, including in Docker, because
// the common case is a container reached only from its host. The server logs a
// warning at startup when it binds a non-loopback address with auth off, which
// is the case where that default is wrong.
// =============================================================================

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.ts";
import { isOwnOrigin } from "../utils/publicOrigin.ts";
import { trimTrailingSlashes } from "../utils/urlPath.ts";
import {
  getUserById,
  resolveSession,
  type User,
} from "../services/authService.ts";
import { resolveToken, TOKEN_PREFIX } from "../services/apiTokenService.ts";
import {
  isAccessToken,
  OAUTH_SCOPES,
  oauthIssuer,
  resolveAccessToken,
  resourceMetadataUrl,
} from "../services/oauthService.ts";
import { sqlite } from "../db.ts";

export const COOKIE_NAME = "contrack_session";

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
  /**
   * `Authorization: Bearer ctk_...`, a personal token from `api_tokens`.
   * `readOnly` is the access its owner chose, see `guardReadOnlyToken`.
   */
  | {
      kind: "user";
      user: User;
      via: "token";
      tokenId: string;
      readOnly: boolean;
    }
  /** Auth is off. The local owner account, which nobody can sign in to. */
  | { kind: "user"; user: User; via: "implicit" };

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

/** The session id backing this request, or null for the other two kinds. */
export function currentSessionId(req: Request): string | null {
  return req.principal?.via === "session" ? req.principal.sessionId : null;
}

// =============================================================================
// Configuration
// =============================================================================

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

/**
 * True when the instance requires a credential.
 *
 * Read per call rather than cached at import, so tests can turn enforcement
 * on and off with the environment variable.
 */
export function isAuthRequired(): boolean {
  return forcedAuth || process.env.AUTH_REQUIRED === "true";
}

/** Reset the forced-auth latch. Test seam. */
export function __resetAuthWarnings(): void {
  forcedAuth = false;
}

// =============================================================================
// Cookie handling
// =============================================================================

/**
 * Minimal cookie parser (avoids a dependency for two cookies).
 *
 * A value that does not decode, such as `%E0%A4%A`, counts as no cookie.
 * `decodeURIComponent` throws on it, and every route answered 500.
 */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Cookie attributes.
 *
 * `SameSite=Strict` keeps the cookie off a request from another site. A page
 * on a sibling subdomain is the same site, though, so it still sends the
 * cookie. `refuseCrossSiteWrites` is the second half of the CSRF defence.
 *
 * `Secure` is set only when the request arrived over HTTPS. Hard-coding it
 * would break plain-HTTP local use (`http://localhost:3210`), which is the
 * default way this app is run; omitting it entirely would drop the flag on
 * the reverse-proxy deployments where it matters most.
 */
function cookieAttributes(req: Request, maxAgeSeconds: number | null): string {
  const secure = isHttps(req) ? "; Secure" : "";
  const maxAge = maxAgeSeconds !== null ? `; Max-Age=${maxAgeSeconds}` : "";
  return `HttpOnly; SameSite=Strict; Path=/${secure}${maxAge}`;
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

export interface SetSessionCookieOptions {
  sessionOnly?: boolean;
}

/** Set the session cookie on a response. */
export function setSessionCookie(
  req: Request,
  res: Response,
  secret: string,
  expiresAt: string,
  options?: SetSessionCookieOptions,
): void {
  const maxAge = options?.sessionOnly
    ? null
    : Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(secret)}; ${cookieAttributes(req, maxAge)}`,
  );
}

/** Clear the session cookie. */
export function clearSessionCookie(req: Request, res: Response): void {
  res.append("Set-Cookie", `${COOKIE_NAME}=; ${cookieAttributes(req, 0)}`);
}

/** Read the session secret this request presented, if any. */
export function presentedSessionSecret(req: Request): string | null {
  return readCookie(req, COOKIE_NAME);
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * True for the MCP endpoint, however the client spells it. Express matches
 * paths without regard to case or a trailing slash, so this must too. It
 * reads `originalUrl`, because a middleware mounted on `/api` sees a `path`
 * with that prefix taken off.
 */
function isMcpPath(req: Request): boolean {
  const path = req.originalUrl.split("?")[0].toLowerCase();
  return trimTrailingSlashes(path) === "/api/mcp";
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
  //    The lookup lives in apiTokenService, which owns that table.
  if (presented?.startsWith(TOKEN_PREFIX)) {
    const user = resolveToken(presented);
    if (user) {
      req.principal = {
        kind: "user",
        user: user.user,
        via: "token",
        tokenId: user.tokenId,
        readOnly: user.readOnly,
      };
      return next();
    }
  }

  // 1b. An app's OAuth access token, which reaches the MCP endpoint and
  //     nothing else. On any other path it identifies nobody, so the request
  //     gets the same 401 as a wrong token.
  if (presented && isAccessToken(presented) && isMcpPath(req)) {
    const grant = resolveAccessToken(presented);
    if (grant) {
      req.principal = {
        kind: "user",
        user: grant.user,
        via: "token",
        tokenId: grant.grantId,
        readOnly: grant.readOnly,
      };
      return next();
    }
  }

  // 2. Session cookie. Resolved even when auth is off, so that someone who
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

  // 3. No credential on an ungated instance: the person at the keyboard is
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
 * The local owner account, read fresh on every request.
 *
 * This row is not cached in memory, on
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
 *
 * A 401 carries `WWW-Authenticate: Bearer`, which is how an MCP client or a
 * script learns that a token is what it lacks (RFC 6750). A token that was
 * sent and refused gets its own message, because "Authentication required"
 * tells somebody holding a revoked token nothing.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isAuthenticated(req)) return next();
  const sentToken = req.headers.authorization?.startsWith("Bearer ") === true;
  // On the MCP endpoint, with OAuth on, the challenge also says where the
  // OAuth metadata is (RFC 9728 §5.1). That is how Claude, ChatGPT and the
  // editors find the sign-in page from the address alone.
  const issuer = isMcpPath(req) ? oauthIssuer() : null;
  res.setHeader(
    "WWW-Authenticate",
    [
      'Bearer realm="contrack"',
      ...(issuer
        ? [
            `resource_metadata="${resourceMetadataUrl(issuer)}"`,
            `scope="${OAUTH_SCOPES.join(" ")}"`,
          ]
        : []),
      ...(sentToken ? ['error="invalid_token"'] : []),
    ].join(", "),
  );
  next(
    new AppError(
      sentToken
        ? "This token is not valid. It may be revoked or expired. Create a new one in Settings → Account → API tokens."
        : "Authentication required. Sign in, or send a token as Authorization: Bearer <token>.",
      401,
      { code: "UNAUTHORIZED" },
    ),
  );
}

/**
 * Gate for every data route while an account still holds a password somebody
 * else chose.
 *
 * An admin who creates an account, or resets one, sets a temporary password
 * and hands it over. Until the person replaces it, that password is known to
 * at least two people, so it buys access to the account's own settings and
 * nothing else. Every path outside `/api/auth/` answers
 * `403 PASSWORD_CHANGE_REQUIRED` until `POST /api/auth/change-password`
 * clears the flag.
 *
 * It applies to `session` and `token` principals alike, because the reason
 * is the password rather than the way it was presented.
 * The `implicit` local owner never carries the flag: it has no password at
 * all, so nobody could have chosen one for it.
 *
 * Mounted after `requireAuth` on `/api` and `/uploads`. The auth router is
 * mounted ahead of it, so its routes never reach the mounted copy, and a
 * route there that needs the guard carries it itself.
 *
 * The exemption is a list of paths rather than the `/api/auth` prefix, so a
 * route in the auth router is guarded unless it is one of the paths an
 * account needs to change its password.
 *
 * It reads `originalUrl` rather than `path`, because Express strips the mount
 * prefix before a middleware sees `req.path`, which would make
 * `/api/auth/me` and `/uploads/auth/me` look alike.
 */

/**
 * What an account with a temporary password still needs: to see the
 * instance's state, sign in, read its own account, set a password of its own,
 * and sign out. Nothing else, under `/api/auth` or anywhere else.
 */
const PASSWORD_CHANGE_EXEMPT = new Set([
  "/api/auth/status",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/change-password",
]);
export function requirePasswordCurrent(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const user = req.principal?.user;
  if (!user || user.mustChangePassword !== 1) return next();

  const pathOnly = req.originalUrl.split("?")[0];
  if (PASSWORD_CHANGE_EXEMPT.has(pathOnly)) return next();

  next(
    new AppError(
      "Set a new password before you use this instance. The one you were given is temporary.",
      403,
      { code: "PASSWORD_CHANGE_REQUIRED" },
    ),
  );
}

/** The methods that read. A read-only token may send these and no others. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Gate for a read-only token: it reads, and it talks to the MCP server.
 *
 * The token may send `GET`, `HEAD` and `OPTIONS`, and `POST /api/mcp`. The
 * MCP server then lists only the tools that change nothing (see
 * `server/mcp/server.ts`). Every other request answers
 * `403 TOKEN_READ_ONLY`.
 *
 * The Google sign-in is refused although both of its routes are `GET`:
 * finishing one adds a connector, which then writes to the account.
 *
 * Mounted ahead of the auth router, so it also covers the preference routes
 * there, the ones a token may write to. The path is lowercased because
 * Express matches routes without regard to case.
 */
export function guardReadOnlyToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const principal = req.principal;
  if (principal?.via !== "token" || !principal.readOnly) return next();

  const path = trimTrailingSlashes(req.originalUrl.split("?")[0].toLowerCase());
  const reads =
    READ_METHODS.has(req.method) && !path.startsWith("/api/connectors/google/");
  if (reads || (req.method === "POST" && path === "/api/mcp")) return next();

  next(
    new AppError(
      "This token is read-only. Create a token with read and write access to change data.",
      403,
      { code: "TOKEN_READ_ONLY" },
    ),
  );
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
  if (!isAuthRequired() && req.principal?.via === "implicit") return next();
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
 * Why this caller may not administer the instance, or null when it may.
 *
 * It takes an admin account, signed in. A token is refused even when its
 * account is an admin. A token proves which account it belongs to, not that
 * the person is there, and an admin's token in a script could otherwise
 * create an admin, reset the first admin's password and export any account.
 * The implicit local owner passes while sign-in is off, as in requireSession.
 */
export function adminRefusal(req: Request): AppError | null {
  const principal = req.principal;
  if (!principal) {
    return new AppError("Authentication required", 401, {
      code: "UNAUTHORIZED",
    });
  }
  if (principal.user.role !== "admin") {
    return new AppError("This endpoint needs an admin account.", 403, {
      code: "ADMIN_REQUIRED",
    });
  }
  if (principal.via === "session") return null;
  if (principal.via === "implicit" && !isAuthRequired()) return null;
  return new AppError(
    "Instance administration needs a signed-in session. A token cannot use it.",
    403,
    { code: "SESSION_REQUIRED" },
  );
}

/**
 * Gate for instance administration: user management, instance settings,
 * backups, the audit log. `adminRefusal` says who passes.
 *
 * Mounted on each admin route individually rather than with `router.use`, so
 * that the route manifest test can look inside `route.stack` and fail when a
 * route classed `admin` does not carry it. That check only works while this
 * is a named function declaration: an arrow assigned to a const has an empty
 * `handle.name` and the test would see nothing.
 */
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const refused = adminRefusal(req);
  if (refused) return next(refused);
  next();
}

/** The methods that change something, which a page on another site may not. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuse a write that the session cookie signs when another site's page sent
 * it.
 *
 * `SameSite=Strict` keeps the cookie off a request from another site, but a
 * page on a sibling subdomain (`other-app.example.com` beside
 * `crm.example.com`) is the same site. A form there can send a `text/plain`
 * POST with the cookie, and one disabled an account. So a write with the
 * cookie must come from this server's own origin:
 * - `Origin` present: it names this host or `PUBLIC_URL` (`isOwnOrigin`).
 * - `Origin` absent: `Sec-Fetch-Site` is `same-origin` or `none`, or absent.
 *   A client that sends neither header is not a browser.
 *
 * A bearer token is not sent by a browser on its own, so a token request
 * passes. So do the OAuth endpoints, which are outside `/api`.
 */
export function refuseCrossSiteWrites(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.principal?.via !== "session" || !WRITE_METHODS.has(req.method)) {
    return next();
  }
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  const own = origin
    ? isOwnOrigin(req, origin)
    : site === undefined || site === "same-origin" || site === "none";
  if (own) return next();
  next(
    new AppError(
      origin
        ? `This request came from a page at ${origin}, which is not the address of the server, so it was refused. If you opened Contrack at that address, set PUBLIC_URL to it.`
        : "This request came from a page on another site, so it was refused.",
      403,
      { code: "CROSS_SITE_REQUEST" },
    ),
  );
}
