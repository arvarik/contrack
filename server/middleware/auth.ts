// =============================================================================
// Authentication — single-user bearer token
// =============================================================================
// The server has one owner. Auth is a single secret token, enforced when:
//   - AUTH_TOKEN is set (the token), or
//   - AUTH_REQUIRED=true (a token is generated once and persisted to
//     DATA_DIR/auth-token — the Docker image sets this so containers are
//     secure by default; the token is printed to the logs on first boot).
//
// Clients authenticate with either:
//   - Authorization: Bearer <token>   (scripts, MCP clients)
//   - contrack_token cookie           (the SPA, set via POST /api/auth/login)
//
// The cookie is HttpOnly + SameSite=Strict, which also serves as CSRF
// protection for the cookie path. Comparison is timing-safe.
// =============================================================================

import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { DATA_DIR } from "../utils/paths.ts";
import { log } from "../utils/logger.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const COOKIE_NAME = "contrack_token";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const TOKEN_FILE = path.join(DATA_DIR, "auth-token");

/** Cached auto-generated token (only used in AUTH_REQUIRED mode). */
let generatedToken: string | null = null;

/**
 * Resolve the active auth token, or null when auth is disabled.
 * Reads env per call so tests can toggle enforcement; the generated-token
 * file is read/created once and cached.
 */
export function resolveAuthToken(): string | null {
  const envToken = process.env.AUTH_TOKEN?.trim();
  if (envToken) return envToken;

  if (process.env.AUTH_REQUIRED === "true") {
    if (generatedToken) return generatedToken;
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        generatedToken = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      } else {
        generatedToken = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(TOKEN_FILE, generatedToken + "\n", { mode: 0o600 });
        log.info("Auth", "Generated new auth token (persisted to auth-token)");
      }
      // Printed on purpose: this is how a Docker user retrieves their token.
      log.info(
        "Auth",
        `Access token: ${generatedToken} — sign in with it, or send it as a Bearer token.`,
      );
      return generatedToken;
    } catch (err) {
      log.error(
        "Auth",
        `AUTH_REQUIRED=true but the token file could not be read/created: ${String(err)}`,
      );
      // Fail closed: no request can authenticate, better than silently open.
      return crypto.randomBytes(32).toString("hex");
    }
  }

  return null;
}

/** True when auth is currently enforced. */
export function isAuthRequired(): boolean {
  return resolveAuthToken() !== null;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Minimal cookie parser (avoids a dependency for one cookie). */
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

/** Extract the presented credential from header or cookie. */
function presentedToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return readCookie(req, COOKIE_NAME);
}

export function isAuthenticated(req: Request): boolean {
  const required = resolveAuthToken();
  if (required === null) return true;
  const presented = presentedToken(req);
  return presented !== null && timingSafeEqualStrings(presented, required);
}

/**
 * Gate middleware for /api/* and /uploads/*. No-op when auth is disabled.
 * The /api/auth/* endpoints are mounted BEFORE this middleware in app.ts,
 * so login/status stay reachable.
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isAuthenticated(req)) return next();
  next(
    new AppError("Authentication required", 401, {
      code: "UNAUTHORIZED",
    }),
  );
}

// =============================================================================
// /api/auth router — status, login (sets cookie), logout
// =============================================================================

const router = Router();

router.get("/status", (req, res) => {
  res.json({
    authRequired: isAuthRequired(),
    authenticated: isAuthenticated(req),
  });
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const required = resolveAuthToken();
    if (required === null) {
      // Auth disabled — treat login as a no-op success.
      return res.json({ success: true });
    }
    const supplied =
      typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!supplied || !timingSafeEqualStrings(supplied, required)) {
      throw new AppError("Invalid token", 401, { code: "UNAUTHORIZED" });
    }
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(supplied)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    );
    res.json({ success: true });
  }),
);

router.post("/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  );
  res.json({ success: true });
});

export const authRouter = router;
