/**
 * server.ts — Express application entry point.
 *
 * Boots the HTTP server: builds the API app via createApp() (see
 * server/app.ts), attaches Vite dev middleware (or static serving in
 * production), starts listening, and kicks off background tasks.
 */
import "dotenv/config";
import express from "express";
import path from "path";

import { log } from "./server/utils/logger.ts";
import { startRetroactiveGeocoding } from "./server/services/geocoding/index.ts";
import { createApp, finalizeApp, notFoundHandler } from "./server/app.ts";
import { relationshipService } from "./server/services/relationshipService.ts";
import {
  isEmbeddingAvailable,
  backfillEmbeddings,
  getEmbeddingCount,
} from "./server/services/dedupe/embeddings.ts";
import {
  initLocalEmbeddings,
  backfillSearchEmbeddings,
} from "./server/services/search/localEmbeddings.ts";

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
  log.warn("Server", `${KEY_VAR} is not configured inside .env!`);
  log.warn(
    "Server",
    `AI provider "${AI_PROVIDER}" will not be available. AI features will fail gracefully.`,
  );
} else {
  log.info("Server", `AI Provider: ${AI_PROVIDER} (${KEY_VAR} configured)`);
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3210;
// Bind localhost by default — this app has no authentication, so exposing it
// on all interfaces should be an explicit choice (HOST=0.0.0.0, set in Docker).
const HOST = process.env.HOST ?? "127.0.0.1";

async function startServer() {
  const app = createApp({ enableRequestLogging: true });

  // ── Cache diagnostics (dev only) ─────────────────────────────────────────
  // Exposes hit/miss counters and entry counts for all aiCache tiers.
  // Useful for debugging: curl http://localhost:3210/api/debug/cache-stats
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
    // Lazy import: vite is a devDependency and must never enter the
    // production module graph (the Docker image installs --omit=dev).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  // Centralized error handler. Translates AppError / ZodError / SQLite
  // codes into a canonical JSON envelope and strips internal details
  // (stack, cause) before responding in production.
  finalizeApp(app);

  app.listen(PORT, HOST, () => {
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info("Server", `Contrack CRM running on http://localhost:${PORT}`);
    log.info("Server", `Bound to ${HOST}`);
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });

  startRetroactiveGeocoding();

  // ── AI Stats: retention cleanup (30-day rolling window) ──────────────
  import("./server/services/aiStatsService.ts").then(
    ({ cleanupOldInvocations }) => {
      cleanupOldInvocations();
    },
  );

  // Relationship scoring: chunked recompute on startup, then hourly sweep.
  // recomputeAll yields to the event loop between batches so requests are
  // never starved by a long synchronous scoring pass.
  const runScoreSweep = () =>
    relationshipService
      .recomputeAll()
      .catch((err) =>
        log.warn("Server", `Relationship score sweep failed: ${err.message}`),
      );
  runScoreSweep();
  setInterval(runScoreSweep, 60 * 60 * 1000);

  // ── Local embedding model for Ask Contrack v3 ───────────────────────────
  // Load the Transformers.js model, then backfill search embeddings.
  // Non-blocking — the server is fully usable while this runs.
  initLocalEmbeddings()
    .then(() => {
      log.info(
        "Server",
        "Local embedding model ready — starting search embedding backfill...",
      );
      return backfillSearchEmbeddings();
    })
    .then((count) => {
      if (count > 0)
        log.info(
          "Server",
          `Search embedding backfill complete: ${count} contacts embedded locally`,
        );
    })
    .catch((err) => {
      log.warn(
        "Server",
        `Local embedding init/backfill failed: ${err.message}`,
      );
    });

  // ── Dedupe embedding backfill (Gemini, for dedupe engine) ───────────────
  if (isEmbeddingAvailable()) {
    const existingCount = getEmbeddingCount();
    if (existingCount === 0) {
      log.info(
        "Server",
        "Starting background embedding backfill for dedupe...",
      );
      backfillEmbeddings()
        .then((count) => {
          if (count > 0)
            log.info(
              "Server",
              `Dedupe embedding backfill complete: ${count} contacts embedded`,
            );
        })
        .catch((err) => {
          log.warn(
            "Server",
            `Dedupe embedding backfill failed: ${err.message}`,
          );
        });
    }
  }
}

startServer();
