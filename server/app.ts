/**
 * app.ts — Express application factory.
 *
 * Builds the fully-wired API app (middleware, routers, error handling)
 * WITHOUT listening on a port, attaching Vite, or starting background
 * tasks — those live in server.ts. This split exists so integration
 * tests can mount the exact production request pipeline with supertest.
 */
import express from "express";
import cors from "cors";
import crypto from "crypto";
import morgan from "morgan";
import { log } from "./utils/logger.ts";
import { styleOrigins } from "./utils/mapConfig.ts";
import {
  PERMISSIONS_POLICY,
  STRICT_TRANSPORT_SECURITY,
  buildContentSecurityPolicy,
} from "./utils/securityHeaders.ts";
import { validatePublicUrl } from "./utils/publicOrigin.ts";
import { trustProxyHops } from "./utils/trustProxy.ts";
import path from "path";

import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import {
  attachPrincipal,
  guardReadOnlyToken,
  isAuthRequired,
  requireAdmin,
  requireAuth,
  requirePasswordCurrent,
  setForcedAuth,
} from "./middleware/auth.ts";
import { attachRequestContext } from "./tenancy/requestContext.ts";
import { guardUploads } from "./middleware/uploads.ts";
import { compressResponses } from "./middleware/compression.ts";
import {
  NO_STORE_PREFIXES,
  UPLOAD_CACHE_CONTROL,
  noStore,
} from "./middleware/cacheControl.ts";
import { aiCache } from "./utils/aiCache.ts";
import { authRouter } from "./routes/auth.ts";
import { healthRouter } from "./routes/health.ts";
import { hostGuard } from "./middleware/hostGuard.ts";
import { mountModules } from "./modules/index.ts";
import { countPasswordAccounts } from "./services/authService.ts";
import { ensureLocalOwner } from "./db.ts";
import {
  aiEndpointRateLimit,
  aiUserRateLimit,
} from "./middleware/rateLimit.ts";
import { requireAiAllowed } from "./middleware/aiAllowed.ts";
import { UPLOADS_DIR, ensureDir } from "./utils/paths.ts";
import { redactUrlForLog } from "./utils/helpers.ts";

/** File extensions browsers may render inline; everything else downloads. */
const INLINE_UPLOAD_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
]);

export interface CreateAppOptions {
  /** Skip the per-IP AI rate limiter (integration tests hammer endpoints). */
  disableRateLimit?: boolean;
  /** Attach morgan request logging (off in tests to keep output readable). */
  enableRequestLogging?: boolean;
}

/**
 * Build the API application: all middleware and routers, ending with the
 * 404 catch-all for /api/* and the centralized error handler. The caller
 * (server.ts) may append SPA/Vite handling between notFoundHandler and
 * errorHandler via the returned app.
 */
/**
 * The one route that legitimately carries multi-megabyte JSON: bulk import
 * posts the parsed contents of a whole CSV/vCard export. Everything else on
 * the API speaks in kilobytes, and a limit sized for the import was letting
 * any caller hold 50 MB of server memory per request on any route —
 * including the unauthenticated ones under /api/auth.
 */
const LARGE_JSON_PATHS = new Set(["/api/contacts/bulk"]);

/** The production policy. Kept as its own name for the map tests. */
export function buildProductionCsp(
  origins: readonly string[] = styleOrigins(),
): string {
  return buildContentSecurityPolicy({ origins });
}

// Morgan's `:url` token is `req.originalUrl`, query string included, and both
// formats this app uses carry it. The query string holds invitation secrets,
// palette searches and pasted URLs, so the access log writes the path alone.
// Overriding the built-in token covers every format rather than one of them.
morgan.token("url", (req) =>
  redactUrlForLog((req as express.Request).originalUrl),
);

export function createApp(options: CreateAppOptions = {}): express.Express {
  validatePublicUrl(process.env.PUBLIC_URL);
  const app = express();
  app.disable("x-powered-by");

  // Express believes X-Forwarded-For, -Proto and -Host only from the hops it
  // is told to trust, and TRUST_PROXY_HOPS says how many proxies sit in front
  // (0 by default, see trustProxy.ts). Behind a proxy it is what makes rate
  // limits and the audit log see the real client, and what marks the session
  // cookie Secure when the original request was HTTPS. Set first, because
  // everything below may read req.ip or req.secure.
  const hops = trustProxyHops();
  app.set("trust proxy", hops > 0 ? hops : false);

  const contentSecurityPolicy = buildContentSecurityPolicy({
    dev: process.env.NODE_ENV !== "production",
  });
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID().slice(0, 8);
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });

  app.use((req, res, next) => {
    // nosniff was previously set on /uploads alone; every response deserves
    // it. DENY matches the CSP's frame-ancestors for older browsers.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    if (req.secure) {
      res.setHeader("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
    }
    next();
  });

  // Brotli or gzip, before every middleware that can answer: the rate limits
  // (429), the health check, the auth gate (401), the uploads, the routers,
  // the error handler, and the Vite or dist handlers that server.ts adds
  // after this function returns. A response that starts before this line
  // goes out uncompressed. The two middlewares above only set headers, and
  // the filter reads the headers when the response starts, so their place
  // relative to this one does not matter. The rules are in compression.ts.
  app.use(compressResponses);

  // The account that owns the data while nobody signs in. The baseline
  // migration makes it, and this keeps it after a test empties the users.
  // Here rather than in server.ts, so tests that build the app get it too.
  ensureLocalOwner();

  // Auth-off mode is valid only while the local owner is the only account.
  // With a real account present there is no answer to "who is the caller with
  // no credential", so the server enforces auth and says so, rather than
  // quietly attributing that caller's writes to somebody.
  if (!isAuthRequired() && countPasswordAccounts() > 0) {
    setForcedAuth(true);
    log.error(
      "Auth",
      "AUTH_REQUIRED is false but accounts exist. Auth is enforced. Set AUTH_REQUIRED=true to silence this.",
    );
  }

  // CORS is off by default: the SPA is same-origin (Vite runs as middleware
  // in this process). Set CORS_ORIGIN to opt in for a browser-based external
  // tool.
  if (process.env.CORS_ORIGIN) {
    app.use(cors({ origin: process.env.CORS_ORIGIN }));
  }
  // The parser must be chosen BEFORE parsing starts — a global 50 MB parser
  // with a stricter one nested in the route never runs the strict one,
  // because the body is already consumed by the time routing happens.
  const defaultJson = express.json({ limit: "1mb" });
  const importJson = express.json({ limit: "50mb" });
  app.use((req, res, next) =>
    LARGE_JSON_PATHS.has(req.path)
      ? importJson(req, res, next)
      : defaultJson(req, res, next),
  );
  // Nothing posts forms, so there is no form parser. Uploads travel as
  // multipart through multer, which carries its own per-route file-size limits.
  if (!options.disableRateLimit) {
    app.use(aiEndpointRateLimit);
  }

  if (options.enableRequestLogging) {
    // `dev` colours its status codes, so it runs only on a terminal.
    const morganFormat =
      process.env.NODE_ENV !== "production" && process.stdout.isTTY
        ? "dev"
        : "short";
    app.use(
      morgan(morganFormat, {
        skip: (req) =>
          req.url.includes("node_modules") ||
          req.url.includes("@vite") ||
          req.url.includes("src/"),
        // Through the logger, so an access line is an `info` line: it has a
        // time and a level, and LOG_LEVEL=warn leaves it out.
        stream: { write: (line: string) => log.info("HTTP", line.trimEnd()) },
      }),
    );
  }

  // Liveness probe, mounted OUTSIDE /api so the auth gate never touches it.
  // Docker's HEALTHCHECK holds no credential.
  app.use(healthRouter);

  // While sign-in is off, answer only the names a web page cannot own, so a
  // DNS rebinding page cannot act as the owner (hostGuard.ts). After the
  // health check, which a probe reaches by any name.
  app.use(hostGuard);

  // Identify the caller before anything else looks at the request. Never
  // rejects — it only decides *who* is asking, which the auth routes need to
  // know even for callers that are nobody.
  app.use(attachPrincipal);

  // Carry who is asking through the async call tree, so an insert can stamp
  // ownerId without threading a parameter through every signature. Mounted
  // after attachPrincipal because it reads req.principal. Attribution only:
  // reads and writes of owned data take an explicit Scope.
  app.use(attachRequestContext);

  // The second AI limiter, per account rather than per address. It has to be
  // here rather than beside the first one: it reads req.principal, which the
  // two middlewares above are what set. One person on a shared office address
  // can no longer spend everybody's provider budget.
  if (!options.disableRateLimit) {
    app.use(aiUserRateLimit);
  }

  // Refuse AI requests when the caller has switched AI off for their account.
  app.use(requireAiAllowed);

  // Nothing under these four prefixes may be stored by a browser or by a
  // proxy. Mounted before the routers so it applies to every response they
  // produce, including the errors. `cacheControl.ts` says why each prefix is
  // on the list.
  app.use([...NO_STORE_PREFIXES], noStore);

  // A read-only token reads, and talks to the MCP server. Mounted before the
  // auth router, so the preference routes there, which a token may write to,
  // are covered too.
  app.use(["/api", "/uploads"], guardReadOnlyToken);

  // Auth endpoints must stay reachable pre-auth (status, setup, login);
  // everything mounted after requireAuth — uploads and all other /api routes —
  // is gated when AUTH_REQUIRED or API_TOKEN is configured.
  app.use("/api/auth", authRouter);
  app.use(["/api", "/uploads"], requireAuth);

  // An account whose password an admin chose reaches its own settings and
  // nothing else. Mounted after the credential gate, because the flag lives on
  // the principal that gate insists on. /api/auth/* is exempt, which is what
  // makes the password change itself reachable.
  app.use(["/api", "/uploads"], requirePasswordCurrent);

  const uploadDir = UPLOADS_DIR;
  ensureDir(uploadDir);
  // Between the credential gate and the file server: requireAuth decides
  // whether there is a caller, and this decides whether the file is theirs.
  app.use("/uploads", guardUploads);
  app.use(
    "/uploads",
    express.static(uploadDir, {
      setHeaders: (res, filePath) => {
        // Uploads are user-supplied content served from the app origin.
        // Never let the browser sniff a different content type, and force
        // non-image files (.eml, .txt, .pdf, legacy uploads) to download
        // instead of rendering — a stored .html/.svg would otherwise run
        // as same-origin script.
        res.setHeader("X-Content-Type-Options", "nosniff");
        // `private`, because express.static's default `public` invites a
        // shared cache to keep one account's attachment and serve it to
        // whoever asks for that URL next.
        res.setHeader("Cache-Control", UPLOAD_CACHE_CONTROL);
        const ext = path.extname(filePath).toLowerCase();
        if (!INLINE_UPLOAD_EXTENSIONS.has(ext)) {
          res.setHeader("Content-Disposition", "attachment");
        }
      },
    }),
  );

  // Every feature's routers, in the order of server/modules/index.ts.
  // Express matches in mount order, so that list's order is part of the
  // behaviour: the mcp module mounts before the contacts module. The admin
  // module comes first, and every route in it carries requireAdmin itself, so
  // that the manifest test can see the guard in each route's stack.
  mountModules(app);

  // ── Cache diagnostics (dev only) ─────────────────────────────────────────
  // Exposes hit/miss counters and entry counts for all aiCache tiers.
  // Useful for debugging: curl http://localhost:3210/api/debug/cache-stats
  //
  // Registered here rather than in server.ts so the route manifest test can
  // see it. A supertest app calls createApp() and never runs server.ts, so a
  // route registered there is invisible to the manifest. Same NODE_ENV guard.
  if (process.env.NODE_ENV !== "production") {
    // The counters describe one in-process cache shared by everybody on the
    // instance, so this is an operator's view even in development.
    app.get("/api/debug/cache-stats", requireAdmin, (_req, res) => {
      res.json(aiCache.getStats());
    });
  }

  return app;
}

/**
 * Finalize the API pipeline: 404 catch-all for unknown /api/* paths and the
 * centralized error handler. server.ts inserts Vite/static SPA handling
 * before calling this; tests call it immediately after createApp().
 */
export function finalizeApp(app: express.Express): express.Express {
  app.use(errorHandler);
  return app;
}

export { notFoundHandler };
