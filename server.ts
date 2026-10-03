/**
 * server.ts — Express application entry point.
 *
 * Boots the HTTP server: builds the API app via createApp() (see
 * server/app.ts), attaches Vite dev middleware (or static serving in
 * production), starts listening, and kicks off background tasks.
 */
import "./server/utils/loadEnv.ts";
import http from "node:http";

import { log } from "./server/utils/logger.ts";
import { sqlite } from "./server/db.ts";
import { createApp, finalizeApp, notFoundHandler } from "./server/app.ts";
import { serveClient } from "./server/serveClient.ts";
import {
  assertNoLegacyAuthToken,
  isAuthRequired,
} from "./server/middleware/auth.ts";
import { countUsers } from "./server/services/authService.ts";
import { getErrorMessage } from "./server/utils/helpers.ts";
import {
  mailLinkOrigin,
  validatePublicUrl,
} from "./server/utils/publicOrigin.ts";
import { trustProxyHops } from "./server/utils/trustProxy.ts";
import { makeDataPrivate } from "./server/utils/privateFiles.ts";
import { DATA_DIR } from "./server/utils/paths.ts";
import { mailService } from "./server/services/mailService.ts";
import { validateSecretKey } from "./server/utils/secretBox.ts";
import { warnRetiredEnv } from "./server/utils/retiredEnv.ts";
import { stopConnectorScheduler } from "./server/connectors/scheduler.ts";
import { dispatchEvents, registerSubscribers } from "./server/events/index.ts";
import {
  moduleJobs,
  moduleSubscribers,
  runModuleStarts,
} from "./server/modules/index.ts";
import {
  registerJobs,
  startJobRunner,
  stopJobRunner,
} from "./server/jobs/runner.ts";

validatePublicUrl(process.env.PUBLIC_URL);
validateSecretKey(process.env.CONTRACK_SECRET_KEY);
// A typo stops the boot here, rather than trusting no proxy or every one.
trustProxyHops();
warnRetiredEnv();

// Owner-only modes for the database, backups, uploads and key, and for every
// file written from here on. See privateFiles.ts.
{
  const notPrivate = makeDataPrivate(DATA_DIR);
  if (notPrivate.length > 0) {
    log.warn(
      "Server",
      `Could not limit these to this user, so other accounts on this machine may read them: ${notPrivate.join(", ")}`,
    );
  }
}

if (process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === "true") {
  log.warn(
    "Connectors",
    "CONNECTORS_ALLOW_PRIVATE_HOSTS is enabled: private IP checks for connectors are disabled",
  );
}

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
    // Keys stored through the AI providers page and custom endpoints live in
    // the database, so "no env key" is not "no AI" — say what to do, not that
    // something is wrong.
    log.info(
      "Server",
      "No AI provider key in the environment. Connect one in Settings → Administration → AI providers (API key or OpenAI-compatible endpoint) — until then AI features degrade gracefully and local semantic search still works.",
    );
  }
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3210;
// Bind localhost by default — this app has no authentication, so exposing it
// on all interfaces should be an explicit choice (HOST=0.0.0.0, set in Docker).
const HOST = process.env.HOST ?? "127.0.0.1";

async function startServer() {
  // Before anything else looks at a credential. An instance still setting the
  // name 1.x used would otherwise boot with no token at all, and an operator
  // who believes their instance is protected would have no way to find out.
  assertNoLegacyAuthToken();

  // ── Events and jobs ─────────────────────────────────────────────────────
  // The reactions to writes and the background work that the modules
  // declare (server/modules/). Both registrations are idempotent, and the
  // services register their own subscribers as well, so a test or a script
  // that writes runs them too.
  registerSubscribers(moduleSubscribers());
  registerJobs(moduleJobs());
  // Boot catches up from the cursors: the reactions to writes that the last
  // process committed and did not get to.
  dispatchEvents();

  // AI keys saved in Settings before 2.0 are plain text in app_settings, and
  // so in every backup. Seal them once, the way other stored secrets are.
  try {
    const { sealStoredAiKeys } =
      await import("./server/services/aiSettingsService.ts");
    sealStoredAiKeys();
  } catch (err) {
    log.warn(
      "Server",
      `Could not encrypt saved AI keys: ${getErrorMessage(err)}`,
    );
  }

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

  // A mailed link must not take its address from a request (see
  // mailLinkOrigin), so without PUBLIC_URL mail carries no link at all. Say
  // so at boot rather than at the first reset somebody asks for.
  if (mailService.isConfigured() && !mailLinkOrigin()) {
    log.warn(
      "Mail",
      "Outgoing mail is set up and PUBLIC_URL is not, so mail sends no sign-in, reset or invitation link. Set PUBLIC_URL to the address people open",
    );
  }

  const app = createApp({ enableRequestLogging: true });

  // 404 catch-all for unknown /api/* paths — runs immediately after the
  // API routers so we don't fall through to Vite or the SPA index.html.
  // Non-/api/* paths are passed through to Vite/static below.
  app.use(notFoundHandler);

  // The HTTP server comes first, so Vite can put its reload socket on it.
  const server = http.createServer(app);
  await serveClient(app, server, {
    production: process.env.NODE_ENV === "production",
  });

  // Centralized error handler. Translates AppError / ZodError / SQLite
  // codes into a canonical JSON envelope and strips internal details
  // (stack, cause) before responding in production.
  finalizeApp(app);

  server.listen(PORT, HOST, () => {
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

  // ── Background jobs ─────────────────────────────────────────────────────
  // One runner for the scheduled work (server/jobs/): the connector tick,
  // the score sweeps, backups, the daily maintenance sweep, the trash purge,
  // the model catalogs, the planner statistics, and the start-up geocoding
  // and photo sweep. At boot it queues again what a restart stopped, even
  // with background jobs off, and runs nothing more in that case.
  if (!startJobRunner()) {
    log.info(
      "Server",
      "Background maintenance and embedding backfills are disabled.",
    );
    return;
  }

  // ── Start-up work ────────────────────────────────────────────────────────
  // Each module's own, in the order of server/modules/index.ts: the search
  // module warms the starter questions and loads the local models, the
  // data-lifecycle module checks the age of the newest backup, and the ai
  // module moves an old research setting. None of it holds the server up.
  runModuleStarts();
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

    // Start no more jobs, and abort the connector syncs in flight. A job
    // still running when the process exits is queued again at the next boot.
    stopJobRunner().catch((err) => {
      log.warn("Server", `Job runner shutdown error: ${getErrorMessage(err)}`);
    });
    stopConnectorScheduler().catch((err) => {
      log.warn(
        "Server",
        `Connector scheduler shutdown error: ${getErrorMessage(err)}`,
      );
    });

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
