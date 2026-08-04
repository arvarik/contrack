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

/** Build the production request pipeline exactly as server.ts does, minus
 *  Vite/static SPA handling and the per-IP rate limiter. */
export function makeTestApp(): Express {
  const app = createApp({ disableRateLimit: true });
  app.use(notFoundHandler);
  return finalizeApp(app);
}
