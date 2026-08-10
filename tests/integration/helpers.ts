// =============================================================================
// Integration helpers — real app, real database
// =============================================================================
// Importing this module pulls in server/app.ts → server/db.ts, which opens a
// real SQLite database inside the temp DATA_DIR created by
// tests/integration-setup.ts (migrations, FTS index, triggers, and indexes
// all run for real).
// =============================================================================

import type { Express } from "express";
import { createApp, finalizeApp, notFoundHandler } from "../../server/app.ts";
import { sqlite } from "../../server/db.ts";

/** Build the production request pipeline exactly as server.ts does, minus
 *  Vite/static SPA handling and the per-IP rate limiter. */
export function makeTestApp(): Express {
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
  return finalizeApp(app);
}
