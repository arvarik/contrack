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
import { sqlite } from "./server/db.ts";
import { startRetroactiveGeocoding } from "./server/services/geocoding/index.ts";
import { createApp, finalizeApp, notFoundHandler } from "./server/app.ts";
import { isAuthRequired } from "./server/middleware/auth.ts";
import { countUsers } from "./server/services/authService.ts";
import { startBackupSchedule } from "./server/services/backupService.ts";
import { contactService } from "./server/services/contactService.ts";
import { getErrorMessage } from "./server/utils/helpers.ts";
import { relationshipService } from "./server/services/relationshipService.ts";
import {
  backfillEmbeddings,
  ensureDedupeEmbeddingStore,
} from "./server/services/dedupe/embeddings.ts";
import {
  initLocalEmbeddings,
  backfillSearchEmbeddings,
  ensureEmbeddingStore,
} from "./server/services/search/localEmbeddings.ts";

// ── AI posture at boot ───────────────────────────────────────────────────────
// This used to check only the key matching AI_PROVIDER (default gemini), so
// an OpenAI-only install booted to "GEMINI_API_KEY is not configured!" —
// telling the user their working setup was broken. Auto-resolution serves
// every capability from ANY configured provider, so report what is actually
// configured instead.
{
  const keyed = (
    [
      ["gemini", "GEMINI_API_KEY"],
      ["openai", "OPENAI_API_KEY"],
      ["anthropic", "ANTHROPIC_API_KEY"],
    ] as const
  )
    .filter(([, envVar]) => {
      const value = process.env[envVar];
      return !!value && value !== "dummy_key";
    })
    .map(([name]) => name);

  if (keyed.length > 0) {
    log.info(
      "Server",
      `AI providers from env: ${keyed.join(", ")} (default: ${(process.env.AI_PROVIDER ?? "gemini").toLowerCase()})`,
    );
  } else {
    // Keys stored through Settings → AI and custom endpoints live in the
    // database, so "no env key" is not "no AI" — say what to do, not that
    // something is wrong.
    log.info(
      "Server",
      "No AI provider key in the environment. Connect one in Settings → AI (API key or OpenAI-compatible endpoint) — until then AI features degrade gracefully and local semantic search still works.",
    );
  }
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3210;
// Bind localhost by default — this app has no authentication, so exposing it
// on all interfaces should be an explicit choice (HOST=0.0.0.0, set in Docker).
const HOST = process.env.HOST ?? "127.0.0.1";

async function startServer() {
  // Report the auth posture at boot rather than leaving it to be discovered on
  // the first request — "why is it asking me to sign in" and "why is it NOT"
  // are both questions best answered by the startup log.
  if (isAuthRequired()) {
    log.info("Auth", "Authentication is ENABLED for /api and /uploads");
    if (countUsers() === 0) {
      log.info(
        "Auth",
        "No account exists yet — open the app to create one. Until then every request is refused.",
      );
    }
  } else if (HOST !== "127.0.0.1" && HOST !== "localhost") {
    log.warn(
      "Auth",
      `Server binds ${HOST} with NO authentication — set AUTH_REQUIRED=true to require sign-in, or API_TOKEN for script access`,
    );
  }

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
    // SPA fallback for navigation only. This used to answer EVERY method —
    // a POST to any unknown path returned index.html with a 200, which reads
    // as success to a script that mistyped an endpoint.
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Centralized error handler. Translates AppError / ZodError / SQLite
  // codes into a canonical JSON envelope and strips internal details
  // (stack, cause) before responding in production.
  finalizeApp(app);

  const server = app.listen(PORT, HOST, () => {
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info("Server", `Contrack CRM running on http://localhost:${PORT}`);
    log.info("Server", `Bound to ${HOST}`);
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });

  // Node closes idle keep-alive sockets after 5 seconds by default. A reverse
  // proxy (OrbStack, nginx, Caddy) reuses connections for longer than that,
  // and a request sent down a socket Node has just closed surfaces to the
  // user as a sporadic 502. The server must always outlast the proxy, so:
  // longer than any common proxy default, and headersTimeout one second more
  // so a request already in flight when the keep-alive expires still parses.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  registerShutdownHandlers(server);

  startRetroactiveGeocoding();

  // ── Data lifecycle: scheduled DB snapshots + trash retention ─────────────
  startBackupSchedule();
  if (process.env.DISABLE_BACKGROUND_JOBS !== "true") {
    const runTrashPurge = () => {
      try {
        contactService.purgeExpiredTrash();
      } catch (err) {
        log.warn("Server", `Trash purge failed: ${getErrorMessage(err)}`);
      }
    };
    runTrashPurge();
    setInterval(runTrashPurge, 24 * 60 * 60 * 1000);
  }

  // ── AI Stats: retention cleanup (30-day rolling window) ──────────────
  import("./server/services/aiStatsService.ts").then(
    ({ cleanupOldInvocations }) => {
      cleanupOldInvocations();
    },
  );

  // ── AI model catalogs ───────────────────────────────────────────────────
  // Populate the per-provider model lists that Settings → AI offers, so the
  // dropdowns are filled on first open rather than after a manual refresh.
  // Only providers whose cache is missing or older than the TTL are fetched,
  // and every failure is swallowed — discovery is never on a critical path.
  const refreshModelCatalogs = () =>
    import("./server/services/aiSettingsService.ts")
      .then(({ refreshStaleModelCaches }) => refreshStaleModelCaches())
      .catch((err) =>
        log.warn("Server", `AI model discovery failed: ${err.message}`),
      );
  refreshModelCatalogs();
  setInterval(refreshModelCatalogs, 24 * 60 * 60 * 1000);

  // Query-planner statistics refresh. SQLite recommends a periodic
  // `PRAGMA optimize` for connections that stay open for days — it re-runs
  // ANALYZE only for tables whose shape drifted, so the common case is a
  // no-op. Daily matches the other maintenance timers; shutdown runs it too.
  if (process.env.DISABLE_BACKGROUND_JOBS !== "true") {
    setInterval(
      () => {
        try {
          sqlite.pragma("optimize");
        } catch (err) {
          log.warn("Server", `PRAGMA optimize failed: ${getErrorMessage(err)}`);
        }
      },
      24 * 60 * 60 * 1000,
    ).unref();
  }

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
      // Reconcile the vector store with the configured embeddings capability
      // (rebuilds + re-embeds when the model changed), then fill any gaps.
      return ensureEmbeddingStore().then(() => backfillSearchEmbeddings());
    })
    .then((count) => {
      if (count > 0)
        log.info(
          "Server",
          `Search embedding backfill complete: ${count} contacts embedded locally`,
        );
      // Dedupe shares the embeddings capability, so it can only run once a
      // backend is ready. Reconcile it (rebuilding if the model changed) and
      // fill any gaps — previously this only ran when the store was entirely
      // empty, so a partial index could never repair itself.
      return ensureDedupeEmbeddingStore().then(() => backfillEmbeddings());
    })
    .then((count) => {
      if (count > 0)
        log.info(
          "Server",
          `Dedupe embedding backfill complete: ${count} contacts embedded`,
        );
    })
    .catch((err) => {
      log.warn("Server", `Embedding init/backfill failed: ${err.message}`);
    });
}

// =============================================================================
// Shutdown and failure handling
// =============================================================================

/**
 * Close cleanly on SIGTERM/SIGINT.
 *
 * `docker stop` sends SIGTERM, waits 10 seconds, then SIGKILLs. Before this
 * handler existed the process took the SIGKILL every time — dropping in-flight
 * requests and closing the database without the WAL checkpoint that a clean
 * `close()` performs. The database is the entire product here; it gets a
 * clean close on every path we control.
 */
function registerShutdownHandlers(server: import("http").Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      // A second signal means "stop waiting" — the operator pressed Ctrl-C
      // twice, or Docker's grace period is about to expire anyway.
      log.warn("Server", `Second ${signal} — exiting immediately`);
      process.exit(1);
    }
    shuttingDown = true;
    log.info("Server", `${signal} received — draining connections`);

    // Refuse new connections, let in-flight requests finish, drop idle
    // keep-alive sockets so they can't hold the close open for 65 seconds.
    server.close(() => {
      try {
        // SQLite's own recommendation for long-lived connections: run
        // `optimize` on close so query-planner statistics reflect the
        // session's writes. Bounded work, milliseconds in practice.
        sqlite.pragma("optimize");
        sqlite.close();
        log.info("Server", "Database closed cleanly");
      } catch (err) {
        log.warn("Server", `Database close failed: ${getErrorMessage(err)}`);
      }
      process.exit(0);
    });
    server.closeIdleConnections();

    // Hard deadline inside Docker's 10-second grace: a hung handler must not
    // ride the close all the way into a SIGKILL mid-write. Closing the
    // database first is the whole point of shutting down at all.
    setTimeout(() => {
      log.warn("Server", "Drain deadline reached — forcing close");
      server.closeAllConnections();
      try {
        sqlite.close();
      } catch {
        /* already closed, or beyond help — exiting either way */
      }
      process.exit(1);
    }, 8_000).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// A rejected promise nobody awaited crashes Node with a bare stack by
// default. Every background chain in startServer carries its own .catch, so
// anything landing here is a bug — log it loudly and keep serving; the state
// is not corrupted by a stray rejection.
process.on("unhandledRejection", (reason) => {
  log.error(
    "Server",
    `Unhandled promise rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
  );
});

// A synchronous throw that escaped every handler leaves the process state
// unknown — continuing risks serving garbage. Close the database and exit
// non-zero so Docker's restart policy brings up a clean process.
process.on("uncaughtException", (err) => {
  log.error("Server", `Uncaught exception: ${err.stack ?? err.message}`);
  try {
    sqlite.close();
  } catch {
    /* nothing left to do with it */
  }
  process.exit(1);
});

startServer().catch((err) => {
  // Boot failed — a port already bound, a broken migration. Without this
  // catch the rejection lands in the handler above with a vaguer shape;
  // with it, the log names boot explicitly and the exit code is honest.
  log.error("Server", `Startup failed: ${getErrorMessage(err)}`);
  process.exit(1);
});
