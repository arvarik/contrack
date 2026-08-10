// =============================================================================
// Routes — Health probe
// =============================================================================
// Mounted at /healthz, OUTSIDE /api and therefore outside the auth gate.
// Docker's HEALTHCHECK and any uptime monitor must be able to ask "is the
// process serving requests" without holding a credential — before this route
// existed, a gated instance answered every probe with 401, which reads as
// "up" to a status-code check and tells a body-reading check nothing.
//
// The response is deliberately two states and no detail: an unauthenticated
// endpoint must not describe the instance (versions, counts, configuration).
// =============================================================================

import { Router } from "express";
import { sqlite } from "../db.ts";

export const healthRouter = Router();

healthRouter.get("/healthz", (_req, res) => {
  try {
    // One indexed no-op proves the event loop AND the database respond —
    // a process can accept sockets long after SQLite stopped answering.
    sqlite.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
