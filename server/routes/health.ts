// =============================================================================
// Routes — Health probe
// =============================================================================
// Mounted at /healthz, OUTSIDE /api and therefore outside the auth gate.
// Docker's HEALTHCHECK and any uptime monitor must be able to ask "is the
// process serving requests" without holding a credential — before this route
// existed, a gated instance answered every probe with 401, which reads as
// "up" to a status-code check and tells a body-reading check nothing.
//
// WHAT IT MAY SAY. Version numbers of the three schemas, and nothing else.
// An unauthenticated endpoint must not describe the instance: no counts, no
// configuration, no account, no name. Extra F4 asked for the schema versions
// specifically, so an operator can confirm a migration ran without opening
// the database or signing in, and that is the whole of the addition. The
// fuller picture — sizes, queues, backups, who is signed in — is behind
// `GET /api/admin/health`, which needs an admin.
//
// The trade is stated rather than assumed: these three numbers tell an
// unauthenticated caller which schema generation this instance is on. That is
// a narrower thing to leak than the application version, which the served
// assets already carry, and it is the price of an operator being able to see
// that an upgrade took effect.
// =============================================================================

import { Router } from "express";
import {
  readTenancyVersion,
  sqlite,
  TENANCY_SCHEMA_VERSION,
  VEC_VERSION,
} from "../db.ts";
import { FTS_SCHEMA_VERSION } from "../services/search/ftsIndex.ts";

export const healthRouter = Router();

healthRouter.get("/healthz", (_req, res) => {
  try {
    // One indexed no-op proves the event loop AND the database respond —
    // a process can accept sockets long after SQLite stopped answering.
    sqlite.prepare("SELECT 1").get();
    res.json({
      status: "ok",
      schema: {
        tenancy: readTenancyVersion(),
        fts: Number(sqlite.pragma("user_version", { simple: true }) ?? 0),
      },
      vec: VEC_VERSION,
      // What this build expects, beside what the database is on. The pair is
      // the point: one number alone cannot tell an operator whether the
      // migration they just ran finished.
      expects: { tenancy: TENANCY_SCHEMA_VERSION, fts: FTS_SCHEMA_VERSION },
    });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
