/**
 * Background jobs API hook.
 *
 * Backs the Background jobs card on Settings → Administration → Instance
 * health: every recurring job with its last run and its next, and the jobs
 * that failed in the last 24 hours. The route is class `admin` and answers a
 * member with `403 ADMIN_REQUIRED`. The types come from its contract in
 * `shared/contracts/jobs.ts`.
 *
 * @module api/jobs
 */
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "./client";
import { jobRoutes } from "../../shared/contracts/jobs";

export type { JobStatus, RecurringJob } from "../../shared/contracts/jobs";

/**
 * Refetched every fifteen seconds, like the rest of the health page: a run
 * that ends while the page is open shows without a reload.
 */
export const useBackgroundJobs = () =>
  useQuery({
    queryKey: ["admin", "jobs"] as const,
    queryFn: ({ signal }) =>
      apiJson(jobRoutes.overview, "/admin/jobs", { signal }),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
