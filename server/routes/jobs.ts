// =============================================================================
// /api/admin/jobs — background jobs, for the Instance health page
// =============================================================================
// Mounted at /api/admin in server/app.ts, beside the admin router. The route
// carries `requireAdmin` itself, so the route manifest test can find the
// guard in its stack.
//
// It answers every recurring job with its last run and its next, and the
// jobs that failed in the last 24 hours with their errors. Nothing here is
// a secret: a job's payload is not part of the answer.
// =============================================================================

import { Router } from "express";
import { requireAdmin } from "../middleware/auth.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { jobsOverview } from "../jobs/runner.ts";

export const jobsRouter = Router();

jobsRouter.get(
  "/jobs",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(jobsOverview());
  }),
);
