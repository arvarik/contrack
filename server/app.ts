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
import path from "path";

import { linkPreviewRouter } from "./routes/linkPreview.ts";
import { searchRouter } from "./routes/search.ts";
import { listsRouter } from "./routes/lists.ts";
import { contactsRouter } from "./routes/contacts.ts";
import { interactionsRouter } from "./routes/interactions.ts";
import { dedupeRouter } from "./routes/dedupe/index.ts";
import { mcpRouter } from "./routes/mcp.ts";
import { actionItemsRouter } from "./routes/actionItems.ts";
import { dashboardRouter } from "./routes/dashboard.ts";
import { aiSearchRouter } from "./routes/aiSearch.ts";
import { aiRouter } from "./routes/ai.ts";
import { aiStatsRouter } from "./routes/aiStats.ts";
import { logosRouter } from "./routes/logos.ts";
import { dataLifecycleRouter } from "./routes/dataLifecycle.ts";
import { aiSettingsRouter } from "./routes/aiSettings.ts";
import { avatarRouter } from "./routes/avatar.ts";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { attachPrincipal, requireAuth } from "./middleware/auth.ts";
import { authRouter } from "./routes/auth.ts";
import { healthRouter } from "./routes/health.ts";
import { reconcileOwnership } from "./services/authService.ts";
import { aiEndpointRateLimit } from "./middleware/rateLimit.ts";
import { UPLOADS_DIR, ensureDir } from "./utils/paths.ts";

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

/**
 * Response headers served on everything.
 *
 * The CSP is production-only: Vite's dev client injects inline script for
 * HMR, so enforcing in dev would break the dev loop while protecting nobody.
 * The built index.html contains no inline script, which is what makes the
 * strict `script-src 'self'` possible. img-src stays open to https: because
 * imported contacts carry avatar URLs pointing at arbitrary hosts;
 * connect-src names the one external API the client calls (Open-Meteo).
 */
const CSP_PRODUCTION = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Leaflet and React set style attributes
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://api.open-meteo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    // nosniff was previously set on /uploads alone; every response deserves
    // it. DENY matches the CSP's frame-ancestors for older browsers.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Content-Security-Policy", CSP_PRODUCTION);
    }
    next();
  });

  // Claim rows written while nobody was signed in. Idempotent and a no-op
  // unless exactly one account exists; lives here rather than in server.ts so
  // that tests, which build the app directly, get the same behaviour.
  reconcileOwnership();

  // Express only believes X-Forwarded-* when told to. Needed for two things
  // behind a reverse proxy: rate limiting by the real client IP rather than
  // the proxy's, and setting `Secure` on the session cookie when the original
  // request was HTTPS. Limited to one hop — trusting the whole chain would let
  // a client forge its own address by sending the header itself.
  app.set("trust proxy", 1);

  // CORS is off by default: the SPA is same-origin (Vite runs as middleware
  // in this process), and this server has no auth. Set CORS_ORIGIN to opt in
  // for a browser-based external tool.
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
  // Nothing posts forms; uploads travel as multipart through multer, which
  // carries its own per-route file-size limits.
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  if (!options.disableRateLimit) {
    app.use(aiEndpointRateLimit);
  }

  app.use((req, _res, next) => {
    req.requestId = crypto.randomUUID().split("-")[0];
    next();
  });

  if (options.enableRequestLogging) {
    const morganFormat =
      process.env.NODE_ENV === "production" ? "short" : "dev";
    app.use(
      morgan(morganFormat, {
        skip: (req) =>
          req.url.includes("node_modules") ||
          req.url.includes("@vite") ||
          req.url.includes("src/"),
      }),
    );
  }

  // Liveness probe, mounted OUTSIDE /api so the auth gate never touches it.
  // Docker's HEALTHCHECK holds no credential.
  app.use(healthRouter);

  // Identify the caller before anything else looks at the request. Never
  // rejects — it only decides *who* is asking, which the auth routes need to
  // know even for callers that are nobody.
  app.use(attachPrincipal);

  // Auth endpoints must stay reachable pre-auth (status, setup, login);
  // everything mounted after requireAuth — uploads and all other /api routes —
  // is gated when AUTH_REQUIRED or API_TOKEN is configured.
  app.use("/api/auth", authRouter);
  app.use(["/api", "/uploads"], requireAuth);

  const uploadDir = UPLOADS_DIR;
  ensureDir(uploadDir);
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
        const ext = path.extname(filePath).toLowerCase();
        if (!INLINE_UPLOAD_EXTENSIONS.has(ext)) {
          res.setHeader("Content-Disposition", "attachment");
        }
      },
    }),
  );

  app.use("/api", avatarRouter);
  app.use("/api/link-preview", linkPreviewRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/lists", listsRouter);
  app.use("/api", contactsRouter);
  app.use("/api", interactionsRouter);
  app.use("/api", mcpRouter);
  app.use("/api", dedupeRouter);
  app.use("/api", actionItemsRouter);
  app.use("/api", dashboardRouter);
  app.use("/api", aiSearchRouter);
  app.use("/api", dataLifecycleRouter);
  app.use("/api/settings/ai", aiSettingsRouter);
  app.use("/api/ai/stats", aiStatsRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/logos", logosRouter);

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
