// /api/admin/jobs: background jobs, for the Instance health page. The route
// carries `requireAdmin` itself, so the route manifest test finds the guard in
// its stack. It answers every recurring job with its last and next run, and the
// jobs that failed in the last 24 hours with their errors. A job's payload is
// not part of the answer.

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
