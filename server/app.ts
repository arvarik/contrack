/**
 * The Express application factory: the wired API (middleware, routers, error
 * handling) without a port, Vite or background tasks, which live in server.ts.
 * Integration tests mount this exact pipeline with supertest.
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
  refuseCrossSiteWrites,
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
import { NotFoundError } from "./utils/AppError.ts";
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
 * The one route that carries multi-megabyte JSON: bulk import posts a whole
 * parsed CSV or vCard export. Everything else speaks in kilobytes, and an
 * import-sized limit everywhere would let any caller, unauthenticated ones
 * included, hold 50 MB of server memory per request.
 */
const LARGE_JSON_PATHS = new Set(["/api/contacts/bulk"]);

/** The production policy. Kept as its own name for the map tests. */
export function buildProductionCsp(
  origins: readonly string[] = styleOrigins(),
): string {
  return buildContentSecurityPolicy({ origins });
}

// Morgan's `:url` is `req.originalUrl`, query string included, and the query
// string holds invitation secrets, palette searches and pasted URLs. Overriding
// the token makes every format log the path alone.
morgan.token("url", (req) =>
  redactUrlForLog((req as express.Request).originalUrl),
);

/**
 * Build the API application: every middleware and router. The caller adds
 * SPA handling, then `finalizeApp` adds the error handler.
 */
export function createApp(options: CreateAppOptions = {}): express.Express {
  validatePublicUrl(process.env.PUBLIC_URL);
  const app = express();
  app.disable("x-powered-by");

  // Express trusts X-Forwarded-For, -Proto and -Host only from the hops it is
  // told to trust: TRUST_PROXY_HOPS proxies (0 by default, see trustProxy.ts).
  // Behind a proxy it makes rate limits and the audit log see the real client,
  // and marks the session cookie Secure when the original request was HTTPS.
  // Set first, because everything below may read req.ip or req.secure.
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
    // nosniff on every response. DENY matches the CSP's frame-ancestors for
    // older browsers.
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

  // Brotli or gzip, before every middleware that can answer (rate limits,
  // health check, auth gate, uploads, routers, error handler, and the Vite or
  // dist handlers server.ts adds later); a response that starts before this
  // line goes out uncompressed. The two middlewares above only set headers,
  // which the filter reads when the response starts. The rules are in
  // compression.ts.
  app.use(compressResponses);

  // The account that owns the data while nobody signs in. The baseline
  // migration makes it, and this keeps it after a test empties the users, here
  // so tests that build the app get it too.
  ensureLocalOwner();

  // Auth-off mode is valid only while the local owner is the only account. With
  // a real account there is no answer to "who is the caller with no
  // credential", so the server enforces auth and says so, rather than quietly
  // giving that caller's writes to somebody.
  if (!isAuthRequired() && countPasswordAccounts() > 0) {
    setForcedAuth(true);
    log.error(
      "Auth",
      "AUTH_REQUIRED is false but accounts exist. Auth is enforced. Set AUTH_REQUIRED=true to silence this.",
    );
  }

  // CORS is off by default: the SPA is same-origin. Set CORS_ORIGIN to allow a
  // browser-based external tool.
  if (process.env.CORS_ORIGIN) {
    app.use(cors({ origin: process.env.CORS_ORIGIN }));
  }
  // The parser is chosen before parsing starts: a global 50 MB parser with a
  // stricter one in the route would consume the body before the strict one
  // runs.
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
    // `dev` colors its status codes, so it runs only on a terminal.
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

  // While sign-in is off, answer only the names a web page cannot own, so a DNS
  // rebinding page cannot act as the owner (hostGuard.ts). After the health
  // check, which a probe reaches by any name.
  app.use(hostGuard);

  // Identify the caller before anything else reads the request. Never rejects:
  // the auth routes need to know who is asking even when it is nobody.
  app.use(attachPrincipal);

  // A write the session cookie signs must come from this server's own pages.
  // SameSite=Strict lets a sibling subdomain's page send the cookie, so this
  // checks Origin and Sec-Fetch-Site (auth.ts), before every router that
  // writes, the auth router included.
  app.use(["/api", "/uploads"], refuseCrossSiteWrites);

  // Carry who is asking through the async call tree, so an insert can stamp
  // ownerId. After attachPrincipal, which sets req.principal. Attribution only:
  // reads and writes of owned data take an explicit Scope.
  app.use(attachRequestContext);

  // The second AI limiter, per account rather than per address, so one person
  // on a shared office address cannot spend everybody's provider budget. Here
  // because it reads req.principal, which the two middlewares above set.
  if (!options.disableRateLimit) {
    app.use(aiUserRateLimit);
  }

  // Refuse AI requests when the caller has switched AI off for their account.
  app.use(requireAiAllowed);

  // Nothing under these prefixes may be stored by a browser or proxy. Before
  // the routers, so it covers every response, errors included.
  // `cacheControl.ts` says why each prefix is listed.
  app.use([...NO_STORE_PREFIXES], noStore);

  // A read-only token reads, and talks to the MCP server. Mounted before the
  // auth router, so the preference routes there, which a token may write to,
  // are covered too.
  app.use(["/api", "/uploads"], guardReadOnlyToken);

  // The auth endpoints stay reachable before sign-in (status, setup, login).
  // Everything mounted after requireAuth, uploads and all other /api routes, is
  // gated when sign-in is required.
  app.use("/api/auth", authRouter);
  app.use(["/api", "/uploads"], requireAuth);

  // An account whose password an admin chose reaches its own settings and
  // nothing else. After the credential gate, because the flag lives on the
  // principal it requires. /api/auth/* is exempt, so the password change itself
  // is reachable.
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
        // Uploads are user content served from the app origin: no content
        // sniffing, and non-image files (.eml, .txt, .pdf, older uploads)
        // download instead of rendering, or a stored .html or .svg would run as
        // same-origin script.
        res.setHeader("X-Content-Type-Options", "nosniff");
        // `private`: express.static's default `public` lets a shared cache
        // serve one account's attachment to whoever asks for that URL next.
        res.setHeader("Cache-Control", UPLOAD_CACHE_CONTROL);
        const ext = path.extname(filePath).toLowerCase();
        if (!INLINE_UPLOAD_EXTENSIONS.has(ext)) {
          res.setHeader("Content-Disposition", "attachment");
        }
      },
    }),
  );
  // A file that is not there answers 404, the same answer as another
  // account's file, rather than falling through to the app's index.html.
  app.use("/uploads", (_req, _res, next) => next(new NotFoundError("File")));

  // Every feature's routers, in the order of server/modules/index.ts. Express
  // matches in mount order, so that order is behavior: the mcp module mounts
  // before the contacts module. The admin module comes first, and each of its
  // routes carries requireAdmin itself, so the manifest test sees the guard.
  mountModules(app);

  // Cache counters for every aiCache tier, in development only (curl
  // http://localhost:3210/api/debug/cache-stats). Registered here, not in
  // server.ts, so the route manifest test, which builds createApp() without
  // server.ts, can see it.
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
 * Finalize the API pipeline with the error handler. server.ts adds the Vite or
 * static SPA handling first; tests call this right after createApp().
 */
export function finalizeApp(app: express.Express): express.Express {
  app.use(errorHandler);
  return app;
}

export { notFoundHandler };
