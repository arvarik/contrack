/**
 * server/routes/connectors.ts — REST endpoints for connector lifecycle, testing and sync.
 *
 * Mounted at `/api/connectors`.
 * Mutation endpoints require a user session (requireSession) so that personal
 * API tokens cannot configure or modify external credentials.
 *
 * @module server/routes/connectors
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validateBody } from "../utils/validators.ts";
import { requireSession } from "../middleware/auth.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { log } from "../utils/logger.ts";
import { AppError } from "../utils/AppError.ts";
import { isDocker, kindsFor } from "../connectors/registry.ts";
import {
  createConnector,
  deleteConnector,
  getConnector,
  listConnectors,
  listCorrespondents,
  listRuns,
  runNow,
  testConnector,
  updateConnector,
} from "../connectors/service.ts";

export const connectorsRouter = Router();

// ── GET /kinds ─────────────────────────────────────────────────────────────
// Returns available connector kinds based on the host platform and containerization.
connectorsRouter.get(
  "/kinds",
  asyncHandler(async (req, res) => {
    const platform = process.platform;
    const docker = isDocker();
    const kinds = kindsFor(platform, docker);
    res.json({ platform, docker, kinds });
  }),
);

// ── GET / ──────────────────────────────────────────────────────────────────
// Lists all connectors owned by the caller (never includes raw secrets).
connectorsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const connectors = listConnectors(scope);
    res.json({ connectors });
  }),
);

// ── POST / ─────────────────────────────────────────────────────────────────
// Creates a new connector after proving credentials via adapter.test.
const createConnectorSchema = z.object({
  kind: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  config: z.record(z.string(), z.unknown()),
  secret: z.unknown().optional(),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
});

connectorsRouter.post(
  "/",
  requireSession,
  validateBody(createConnectorSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const rid = req.requestId;
    const created = await createConnector(scope, req.body, req.ip ?? null);
    log.info(
      "Connectors",
      `[${rid}] POST /api/connectors → "${created.name}" (${created.id})`,
    );
    res.status(201).json(created);
  }),
);

// ── POST /test ─────────────────────────────────────────────────────────────
// Proves credentials with the adapter without persisting anything.
const testConnectorSchema = z.object({
  kind: z.string().trim().min(1),
  config: z.record(z.string(), z.unknown()),
  secret: z.unknown().optional(),
});

connectorsRouter.post(
  "/test",
  requireSession,
  validateBody(testConnectorSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const result = await testConnector(
      scope,
      req.body.kind,
      req.body.config,
      req.body.secret,
    );
    res.json(result);
  }),
);

// ── GET /correspondents ────────────────────────────────────────────────────
// Lists unknown people seen by connectors who are not contacts yet.
connectorsRouter.get(
  "/correspondents",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const limit = req.query.limit
      ? Math.min(Math.max(1, parseInt(String(req.query.limit), 10) || 50), 100)
      : 50;
    const correspondents = listCorrespondents(scope, limit);
    res.json({ correspondents });
  }),
);

// ── GET /:id ───────────────────────────────────────────────────────────────
// Returns connector detail including recent run history.
connectorsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const connector = getConnector(scope, String(req.params.id));
    if (!connector) {
      throw new AppError("Connector not found", 404);
    }
    res.json(connector);
  }),
);

// ── PATCH /:id ─────────────────────────────────────────────────────────────
// Updates connector name, config, secret, intervalMinutes, or status.
const updateConnectorSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secret: z.unknown().optional(),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

connectorsRouter.patch(
  "/:id",
  requireSession,
  validateBody(updateConnectorSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const updated = await updateConnector(
      scope,
      String(req.params.id),
      req.body,
      req.ip ?? null,
    );
    res.json(updated);
  }),
);

// ── DELETE /:id ────────────────────────────────────────────────────────────
// Removes a connector. When deleteImported is true, also removes interactions
// and ghost contacts created by this connector.
connectorsRouter.delete(
  "/:id",
  requireSession,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const deleteImported =
      req.body?.deleteImported === true || req.query?.deleteImported === "true";
    await deleteConnector(
      scope,
      String(req.params.id),
      { deleteImported },
      req.ip ?? null,
    );
    res.status(204).end();
  }),
);

// ── POST /:id/sync ─────────────────────────────────────────────────────────
// Triggers an immediate sync run. Runs synchronously if background jobs are disabled.
connectorsRouter.post(
  "/:id/sync",
  requireSession,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const id = String(req.params.id);

    // Verify connector exists and is owned by caller
    const existing = getConnector(scope, id);
    if (!existing) {
      throw new AppError("Connector not found", 404);
    }

    if (process.env.DISABLE_BACKGROUND_JOBS === "true") {
      const result = await runNow(scope, id, "manual");
      res.status(202).json({ runId: result.runId });
    } else {
      // Run in background and return 202 immediately
      const runPromise = runNow(scope, id, "manual");
      // Prevent unhandled rejection
      runPromise.catch((err) =>
        log.error("Connectors", `Background sync failed for connector ${id}`, {
          error: err,
        }),
      );
      // Wait a tick for runNow to create the run row so runId is known
      const runId = await Promise.race([
        runPromise.then((r) => r.runId),
        new Promise<string>((resolve) => setTimeout(resolve, 50)).then(() => {
          const runs = listRuns(scope, id, 1);
          return runs[0]?.id ?? "run-queued";
        }),
      ]);
      res.status(202).json({ runId });
    }
  }),
);

// ── GET /:id/runs ──────────────────────────────────────────────────────────
// Returns run history for a specific connector.
connectorsRouter.get(
  "/:id/runs",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const limit = req.query.limit
      ? Math.min(Math.max(1, parseInt(String(req.query.limit), 10) || 20), 100)
      : 20;
    const runs = listRuns(scope, String(req.params.id), limit);
    res.json({ runs });
  }),
);
