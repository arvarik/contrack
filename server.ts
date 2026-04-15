/**
 * server.ts — Express application entry point.
 *
 * Boots the HTTP server with all API routers, Vite dev middleware (or static
 * serving in production), request ID tracing, Morgan logging, centralized
 * error handling via AppError, and background geocoding on startup.
 */
import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import crypto from "crypto";
import morgan from "morgan";
import fs from "fs";

import { log } from "./server/utils/logger.ts";
import { startRetroactiveGeocoding } from "./server/services/geocoding/index.ts";

import { linkPreviewRouter } from "./server/routes/linkPreview.ts";
import { searchRouter } from "./server/routes/search.ts";
import { listsRouter } from "./server/routes/lists.ts";
import { contactsRouter } from "./server/routes/contacts.ts";
import { interactionsRouter } from "./server/routes/interactions.ts";
import { dedupeRouter } from "./server/routes/dedupe/index.ts";
import { mcpRouter } from "./server/routes/mcp.ts";
import { actionItemsRouter } from "./server/routes/actionItems.ts";
import { dashboardRouter } from "./server/routes/dashboard.ts";
import { aiSearchRouter } from "./server/routes/aiSearch.ts";
import { aiRouter } from "./server/routes/ai.ts";
import { aiStatsRouter } from "./server/routes/aiStats.ts";
import { logosRouter } from "./server/routes/logos.ts";
import { relationshipService } from "./server/services/relationshipService.ts";
import { isEmbeddingAvailable, backfillEmbeddings, getEmbeddingCount } from "./server/services/dedupe/embeddings.ts";
import { initLocalEmbeddings, backfillSearchEmbeddings } from "./server/services/search/localEmbeddings.ts";

import { AppError } from "./server/utils/AppError.ts";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY || GEMINI_KEY === "dummy_key") {
  console.warn("\n\x1b[33m⚠️  [WARNING] GEMINI_API_KEY is not configured inside .env!\x1b[0m");
  console.warn("\x1b[33m   AI features (Briefings, Entity Extraction) will fail gracefully.\x1b[0m\n");
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use((req, res, next) => {
    (req as any).requestId = crypto.randomUUID().split("-")[0];
    next();
  });

  const morganFormat = process.env.NODE_ENV === "production" ? "short" : "dev";
  app.use(morgan(morganFormat, {
    skip: (req) => req.url.includes("node_modules") || req.url.includes("@vite") || req.url.includes("src/")
  }));

  app.use("/uploads", express.static(uploadDir));

  app.use("/api/link-preview", linkPreviewRouter); // Using renamed router
  app.use("/api/search", searchRouter);
  app.use("/api/lists", listsRouter);
  app.use("/api", contactsRouter);
  app.use("/api", interactionsRouter);
  app.use("/api", mcpRouter);
  app.use("/api", dedupeRouter);
  app.use("/api", actionItemsRouter);
  app.use("/api", dashboardRouter);
  app.use("/api", aiSearchRouter);
  app.use("/api/ai/stats", aiStatsRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/logos", logosRouter);

  // ── Cache diagnostics (dev only) ─────────────────────────────────────────
  // Exposes hit/miss counters and entry counts for all aiCache tiers.
  // Useful for debugging: curl http://localhost:3000/api/debug/cache-stats
  if (process.env.NODE_ENV !== "production") {
    const { aiCache } = await import("./server/utils/aiCache.ts");
    app.get("/api/debug/cache-stats", (_req, res) => {
      res.json(aiCache.getStats());
    });
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const isProd = process.env.NODE_ENV === "production";
    const requestId = (req as any).requestId;
    
    let statusCode = 500;
    let message = "Internal Server Error";
    let isOperational = false;

    if (err instanceof AppError) {
      statusCode = err.statusCode;
      message = err.message;
      isOperational = err.isOperational;
    } else if (err.type === "entity.parse.failed") {
      statusCode = 400;
      message = "Invalid JSON payload format";
      isOperational = true;
    } else if (err.code === "SQLITE_CONSTRAINT") {
      statusCode = 400;
      message = "Database constraint violation";
      isOperational = true;
    } else if (err.code === "SQLITE_BUSY") {
      statusCode = 503;
      message = "Database is currently busy, please try again later";
      isOperational = true;
    }

    if (!isOperational && statusCode === 500) {
      // Log full stack trace for generic errors
      log.error("Unhandled", `[${requestId}] ${err.stack || err.message}`);
    } else {
      // Log operational error appropriately
      log.error("Operational", `[${requestId}] ${statusCode} - ${message}`);
    }

    res.status(statusCode).json({
      error: message,
      ...(isProd ? {} : { stack: err.stack })
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info("Server", `Contrack CRM running on http://localhost:${PORT}`);
    log.info("Server", `Database: curator.db | Uploads: ${uploadDir}`);
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });

  startRetroactiveGeocoding();

  // ── AI Stats: retention cleanup (30-day rolling window) ──────────────
  import("./server/services/aiStatsService.ts").then(({ cleanupOldInvocations }) => {
    cleanupOldInvocations();
  });

  // Relationship scoring: full recompute on startup, then hourly sweep
  relationshipService.recomputeAll();
  setInterval(() => relationshipService.recomputeAll(), 60 * 60 * 1000);

  // ── Local embedding model for Ask Contrack v3 ───────────────────────────
  // Load the Transformers.js model, then backfill search embeddings.
  // Non-blocking — the server is fully usable while this runs.
  initLocalEmbeddings().then(() => {
    log.info("Server", "Local embedding model ready — starting search embedding backfill...");
    return backfillSearchEmbeddings();
  }).then(count => {
    if (count > 0) log.info("Server", `Search embedding backfill complete: ${count} contacts embedded locally`);
  }).catch(err => {
    log.warn("Server", `Local embedding init/backfill failed: ${err.message}`);
  });

  // ── Dedupe embedding backfill (Gemini, for dedupe engine) ───────────────
  if (isEmbeddingAvailable()) {
    const existingCount = getEmbeddingCount();
    if (existingCount === 0) {
      log.info("Server", "Starting background embedding backfill for dedupe...");
      backfillEmbeddings().then(count => {
        if (count > 0) log.info("Server", `Dedupe embedding backfill complete: ${count} contacts embedded`);
      }).catch(err => {
        log.warn("Server", `Dedupe embedding backfill failed: ${err.message}`);
      });
    }
  }
}

startServer();
