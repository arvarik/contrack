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

import { errorHandler, notFoundHandler } from "./server/middleware/errorHandler.ts";

// ── Provider-aware API key validation ────────────────────────────────────────
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
const API_KEY_MAP: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};
const KEY_VAR = API_KEY_MAP[AI_PROVIDER] ?? "GEMINI_API_KEY";
const KEY_VALUE = process.env[KEY_VAR];

if (!KEY_VALUE || (AI_PROVIDER === "gemini" && KEY_VALUE === "dummy_key")) {
  console.warn(`\n\x1b[33m⚠️  [WARNING] ${KEY_VAR} is not configured inside .env!\x1b[0m`);
  console.warn(`\x1b[33m   AI provider "${AI_PROVIDER}" will not be available. AI features will fail gracefully.\x1b[0m\n`);
} else {
  console.log(`\x1b[36mℹ️  AI Provider: ${AI_PROVIDER} (${KEY_VAR} configured)\x1b[0m`);
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

  // 404 catch-all for unknown /api/* paths — runs immediately after the
  // API routers so we don't fall through to Vite or the SPA index.html.
  // Non-/api/* paths are passed through to Vite/static below.
  app.use(notFoundHandler);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  // Centralized error handler. Translates AppError / ZodError / SQLite
  // codes into a canonical JSON envelope and strips internal details
  // (stack, cause) before responding in production.
  app.use(errorHandler);

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
