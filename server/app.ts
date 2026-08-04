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
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { authRouter, requireAuth } from "./middleware/auth.ts";
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
export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // CORS is off by default: the SPA is same-origin (Vite runs as middleware
  // in this process), and this server has no auth. Set CORS_ORIGIN to opt in
  // for a browser-based external tool.
  if (process.env.CORS_ORIGIN) {
    app.use(cors({ origin: process.env.CORS_ORIGIN }));
  }
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
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

  // Auth endpoints must stay reachable pre-auth (login/status); everything
  // mounted after requireAuth — uploads and all other /api routes — is gated
  // when AUTH_TOKEN / AUTH_REQUIRED is configured.
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
