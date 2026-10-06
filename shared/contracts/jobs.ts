// Contracts: background jobs
// The admin's view of the job runner (server/jobs/runner.ts), under
// /api/admin/jobs: every recurring job with its last run and its next, and
// the jobs that failed in the last 24 hours. A job's payload is not part of
// the answer.

import { z } from "zod";
import { route } from "./route.ts";

/** Where a job is in its life. */
const jobStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
]);

/** A job that runs by itself, every `every` milliseconds. */
const recurringJobSchema = z
  .strictObject({
    kind: z.string(),
    /** Milliseconds between runs, or null when the job is switched off. */
    every: z.number().positive().nullable(),
    lastRunAt: z.string().nullable(),
    lastStatus: jobStatusSchema.nullable(),
    nextRunAt: z.string().nullable(),
  })
  .meta({ id: "RecurringJob" });

/** A job that ended without doing its work, with the reason. */
const failedJobSchema = z
  .strictObject({
    id: z.string(),
    kind: z.string(),
    /** The account it worked for, or null for the instance's own work. */
    ownerId: z.string().nullable(),
    lastError: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .meta({ id: "FailedJob" });

const backgroundJobsSchema = z.strictObject({
  recurring: z.array(recurringJobSchema),
  /** The last 24 hours, newest first, 50 at most. */
  failed: z.array(failedJobSchema),
});

export const jobRoutes = {
  overview: route({
    method: "GET",
    path: "/api/admin/jobs",
    summary:
      "Every recurring background job with its last and next run, and the jobs that failed in the last 24 hours. Admin only",
    response: backgroundJobsSchema,
  }),
};

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type RecurringJob = z.infer<typeof recurringJobSchema>;
export type BackgroundJobs = z.infer<typeof backgroundJobsSchema>;
