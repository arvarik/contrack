// =============================================================================
// Routes — Health probe
// =============================================================================
// Mounted at /healthz, OUTSIDE /api and therefore outside the auth gate.
// Docker's HEALTHCHECK and any uptime monitor must be able to ask "is the
// process serving requests" without holding a credential — before this route
// existed, a gated instance answered every probe with 401, which reads as
// "up" to a status-code check and tells a body-reading check nothing.
//
// WHAT IT MAY SAY. The schema migration this database is on, the last one
// this build holds, and the sqlite-vec version. Nothing else. An
// unauthenticated endpoint must not describe the instance: no counts, no
// configuration, no account, no name. Extra F4 asked for the schema versions
// specifically, so an operator can confirm a migration ran without opening
// the database or signing in, and that is the whole of the addition. The
// fuller picture — the version of each derived index, sizes, queues, backups,
// who is signed in — is behind `GET /api/admin/health`, which needs an admin.
//
// The trade is stated rather than assumed: these values tell an
// unauthenticated caller which schema generation this instance is on. That is
// a narrower thing to leak than the application version, which the served
// assets already carry, and it is the price of an operator being able to see
// that an upgrade took effect.
// =============================================================================

import { Router } from "express";
import { sqlite, VEC_VERSION } from "../db.ts";
import { LATEST_MIGRATION } from "../db/migrations/index.ts";
import { appliedMigrations } from "../db/runner.ts";

export const healthRouter = Router();

healthRouter.get("/healthz", (_req, res) => {
  try {
    // One indexed no-op proves the event loop AND the database respond —
    // a process can accept sockets long after SQLite stopped answering.
    sqlite.prepare("SELECT 1").get();
    res.json({
      status: "ok",
      // What this database is on, beside what the build expects. The pair is
      // the point: one value alone cannot tell an operator whether the
      // migration they just ran finished.
      schema: {
        migration: appliedMigrations(sqlite).at(-1) ?? null,
        expects: LATEST_MIGRATION,
      },
      vec: VEC_VERSION,
    });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
