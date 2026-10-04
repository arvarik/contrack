// =============================================================================
// Routes — OAuth sign-in for MCP clients
// =============================================================================
// Two routers, because they sit on two sides of the credential gate:
//
// - `oauthRouter`, outside /api, is what other programs call: the metadata
//   documents under /.well-known, and /oauth/authorize, token, register and
//   revoke. None of these reads a session. Each answers a JSON 404 while
//   OAuth is off, which it is unless sign-in is on and PUBLIC_URL is https
//   (or http on a loopback name).
// - `oauthConsentRouter`, under /api/auth/oauth, is what the consent page in
//   the app calls with the person's session.
//
// The flow and its rules are in server/services/oauthService.ts.
// =============================================================================

import express, { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import {
  currentUser,
  isAuthRequired,
  requireSession,
} from "../middleware/auth.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { validateBody } from "../utils/validators.ts";
import { oauthRoutes } from "../../shared/contracts/oauth.ts";
import {
  OAUTH_SCOPES,
  OAuthError,
  assertClientKnown,
  beginAuthorization,
  decideRequest,
  describeRequest,
  exchangeCode,
  mcpResource,
  oauthIssuer,
  refreshGrant,
  registerClient,
  revokeOAuthToken,
} from "../services/oauthService.ts";

/** The issuer while OAuth is on, or null. */
function issuer(): string | null {
  return isAuthRequired() ? oauthIssuer() : null;
}

/** The endpoints answer JSON 404s while OAuth is off. */
function requireOAuth(req: Request, res: Response, next: NextFunction): void {
  if (issuer()) return next();
  res.status(404).json({
    error: "not_found",
    error_description:
      "OAuth is off on this Contrack. It needs sign-in (AUTH_REQUIRED=true) and PUBLIC_URL set to the https address people open.",
  });
}

/**
 * Other sites call these from a browser, such as an inspector or a web
 * editor. They hold no cookie and grant nothing by themselves, so any origin
 * may read them, without credentials.
 */
function openToAnyOrigin(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, MCP-Protocol-Version",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "WWW-Authenticate, Retry-After",
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

/** An OAuth error as RFC 6749 §5.2 writes it, never as the app's envelope. */
function sendOAuthError(res: Response, err: unknown): void {
  if (!(err instanceof OAuthError)) {
    log.error("OAuth", "An OAuth endpoint failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const known =
    err instanceof OAuthError
      ? err
      : new OAuthError(
          "server_error",
          "The server could not finish this.",
          500,
        );
  res.status(known.status).json({
    error: known.error,
    error_description: known.description,
  });
}

const perAddress = (name: string, max: number, windowMs = 60_000) =>
  createRateLimiter({ windowMs, max, name, keyBy: (req) => req.ip ?? null });

const authorizeLimit = perAddress("OAuth authorize", 60);
const tokenLimit = perAddress("OAuth token", 60);
const revokeLimit = perAddress("OAuth revoke", 30);
const registerLimit = perAddress("OAuth register", 10, 60 * 60_000);
const consentLimit = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  name: "OAuth consent",
  keyBy: (req) => req.principal?.user.id ?? req.ip ?? null,
});

/** Test seam: start every limiter empty. */
export function __resetOAuthRateLimits(): void {
  for (const limiter of [
    authorizeLimit,
    tokenLimit,
    revokeLimit,
    registerLimit,
    consentLimit,
  ]) {
    limiter.reset();
  }
}

/** Form bodies, on the three endpoints whose clients send them only. */
const form = express.urlencoded({ extended: false, limit: "16kb" });

const router = Router();

router.use(
  [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
    "/oauth/token",
    "/oauth/register",
    "/oauth/revoke",
  ],
  openToAnyOrigin,
);

/**
 * The protected resource metadata (RFC 9728). The 401 from /api/mcp points
 * here. The root copy names the same resource: Contrack has one.
 */
function protectedResource(_req: Request, res: Response): void {
  const base = issuer()!;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    resource: mcpResource(base),
    authorization_servers: [base],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Contrack",
  });
}
router.get(
  "/.well-known/oauth-protected-resource/api/mcp",
  requireOAuth,
  protectedResource,
);
router.get(
  "/.well-known/oauth-protected-resource",
  requireOAuth,
  protectedResource,
);

/** The authorization server metadata (RFC 8414). */
router.get(
  "/.well-known/oauth-authorization-server",
  requireOAuth,
  (_req, res) => {
    const base = issuer()!;
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: OAUTH_SCOPES,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  },
);

/**
 * The link a client opens in the browser. It checks the request and sends
 * the browser on: to the consent page, back to the client with an error, or
 * to the consent page's error view when the client cannot be trusted with a
 * redirect at all.
 */
router.get(
  "/oauth/authorize",
  requireOAuth,
  authorizeLimit,
  asyncHandler(async (req, res) => {
    const outcome = await beginAuthorization(
      issuer()!,
      req.query as Record<string, unknown>,
    );
    const to =
      "consent" in outcome
        ? outcome.consent
        : "redirect" in outcome
          ? outcome.redirect
          : `/oauth/consent?error=${outcome.problem}`;
    res.redirect(303, to);
  }),
);

router.post(
  "/oauth/token",
  requireOAuth,
  tokenLimit,
  form,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      await assertClientKnown(body.client_id);
      if (body.grant_type === "authorization_code") {
        res.json(exchangeCode(issuer()!, body, req.ip ?? null));
      } else if (body.grant_type === "refresh_token") {
        res.json(refreshGrant(issuer()!, body, req.ip ?? null));
      } else {
        throw new OAuthError(
          "unsupported_grant_type",
          "Use authorization_code or refresh_token.",
        );
      }
    } catch (err) {
      sendOAuthError(res, err);
    }
  }),
);

router.post("/oauth/register", requireOAuth, registerLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.status(201).json(registerClient(req.body));
  } catch (err) {
    sendOAuthError(res, err);
  }
});

/** RFC 7009: answers 200 whether or not the token was known. */
router.post("/oauth/revoke", requireOAuth, revokeLimit, form, (req, res) => {
  revokeOAuthToken(
    (req.body as Record<string, unknown> | undefined)?.token,
    req.ip ?? null,
  );
  res.json({});
});

/**
 * What fails before a handler runs, such as a rate limit or a body that does
 * not parse, still answers in OAuth's words, which is all a client reads.
 */
router.use(
  ["/oauth/token", "/oauth/register", "/oauth/revoke"],
  (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof AppError && err.statusCode === 429) {
      const wait = (err.details as { retryAfterSeconds?: number } | undefined)
        ?.retryAfterSeconds;
      if (wait) res.setHeader("Retry-After", String(wait));
      return sendOAuthError(
        res,
        new OAuthError("temporarily_unavailable", err.message, 429),
      );
    }
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      return sendOAuthError(
        res,
        new OAuthError("invalid_request", "The request body did not parse."),
      );
    }
    sendOAuthError(res, err);
  },
);

export const oauthRouter = router;

// -----------------------------------------------------------------------------
// The consent page's two calls, with the person's session.
// -----------------------------------------------------------------------------

const consent = Router();

/** The consent page's calls answer in the app's error envelope. */
function requireOAuthForApp(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (issuer()) return next();
  next(
    new AppError(
      "OAuth is off on this Contrack. It needs sign-in and PUBLIC_URL set to the https address people open.",
      404,
      { code: "OAUTH_OFF" },
    ),
  );
}

consent.get(
  "/auth/oauth/requests/:id",
  requireSession,
  requireOAuthForApp,
  (req, res) => {
    res.json(describeRequest(String(req.params.id)));
  },
);

consent.post(
  "/auth/oauth/requests/:id",
  requireSession,
  requireOAuthForApp,
  consentLimit,
  validateBody(oauthRoutes.decide.body),
  (req, res) => {
    const { decision, access } = req.body as {
      decision: "allow" | "deny";
      access?: "read" | "write";
    };
    res.json(
      decideRequest(
        issuer()!,
        currentUser(req)!,
        String(req.params.id),
        { allow: decision === "allow", readOnly: access !== "write" },
        req.ip ?? null,
      ),
    );
  },
);

export const oauthConsentRouter = consent;
