/**
 * Background jobs API hook.
 *
 * Backs the Background jobs card on Settings → Administration → Instance
 * health: every recurring job with its last run and its next, and the jobs
 * that failed in the last 24 hours. The route is class `admin` and answers a
 * member with `403 ADMIN_REQUIRED`.
 *
 * @module api/jobs
 */
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "./client";

/** Where a job is in its life. */
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** A job that runs by itself, every `every` milliseconds. */
export interface RecurringJob {
  kind: string;
  /** Milliseconds between runs, or null when the job is switched off. */
  every: number | null;
  lastRunAt: string | null;
  lastStatus: JobStatus | null;
  nextRunAt: string | null;
}

/** A job that ended without doing its work, with the reason. */
interface FailedJob {
  id: string;
  kind: string;
  /** The account it worked for, or null for the instance's own work. */
  ownerId: string | null;
  lastError: string | null;
  finishedAt: string | null;
}

export interface BackgroundJobs {
  recurring: RecurringJob[];
  /** The last 24 hours, newest first. */
  failed: FailedJob[];
}

/**
 * Refetched every fifteen seconds, like the rest of the health page: a run
 * that ends while the page is open shows without a reload.
 */
export const useBackgroundJobs = () =>
  useQuery({
    queryKey: ["admin", "jobs"] as const,
    queryFn: ({ signal }) => apiJson<BackgroundJobs>("/admin/jobs", { signal }),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
