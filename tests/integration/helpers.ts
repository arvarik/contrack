// =============================================================================
// Integration helpers — real app, real database
// =============================================================================
// Importing this module pulls in server/app.ts → server/db.ts, which opens a
// real SQLite database inside the temp DATA_DIR created by
// tests/integration-setup.ts (migrations, FTS index, triggers, and indexes
// all run for real).
// =============================================================================

import http from "http";
import { createApp, finalizeApp, notFoundHandler } from "../../server/app.ts";
import { sqlite } from "../../server/db.ts";

/**
 * Build the production request pipeline exactly as server.ts does, minus
 * Vite/static SPA handling and the per-IP rate limiter.
 *
 * Returns a server that is ALREADY LISTENING, and that is the point.
 *
 * `request(expressApp)` makes supertest bind a fresh HTTP server and tear it
 * down again for every single request — roughly 500 listen/close cycles per
 * run. Ephemeral ports get recycled far faster than closed sockets leave
 * TIME_WAIT, so a new server occasionally inherits a port a previous
 * connection is still addressing, and a request is answered by the wrong
 * socket. The symptom is a status the route cannot produce: a 404 from a
 * registered path, a 403 from a router with no 403 in it, a 401 on an
 * un-gated instance. Chasing one of those means auditing auth code that was
 * never involved.
 *
 * Supertest reuses a server that already has an address instead of binding
 * one, so listening once per file removes the recycling entirely. `unref()`
 * keeps the open socket from holding the worker process alive after the last
 * test.
 */
export function makeTestApp(): http.Server {
  // A real better-sqlite3 connection reports `open`; the unit project's mock
  // does not. Checked here so that a leaked mock fails once, by name, instead
  // of surfacing later as an unrelated 404 in whichever test ran next.
  if (!(sqlite as unknown as { open?: boolean }).open) {
    throw new Error(
      "Integration tests require the real database, but server/db.ts is mocked. " +
        "Check that tests/integration-setup.ts ran for this file.",
    );
  }

  const app = createApp({ disableRateLimit: true });
  app.use(notFoundHandler);

  // Bound to loopback explicitly: supertest addresses the server as
  // 127.0.0.1 regardless of what it is bound to, so the default dual-stack
  // wildcard only widens what the test server accepts.
  const server = http.createServer(finalizeApp(app));
  server.listen(0, "127.0.0.1");
  server.unref();
  return server;
}
