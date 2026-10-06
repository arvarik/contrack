// The health probe, at /healthz, outside /api and the auth gate, so Docker's
// HEALTHCHECK and uptime monitors can ask whether the process serves requests
// without a credential (a 401 reads as "up" to a status check and tells a body
// check nothing).
//
// It says only the schema migration this database is on, the last one this
// build holds, and the sqlite-vec version, so an operator can confirm a
// migration ran without signing in. An unauthenticated endpoint must not
// describe the instance: no counts, configuration, accounts or names. The rest
// is behind `GET /api/admin/health`. These values do tell anybody which schema
// generation the instance is on, a narrower leak than the application version,
// which the served assets already carry.

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
