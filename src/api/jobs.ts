/**
 * The Background jobs card on Instance health: each recurring job's last and
 * next run, and the jobs that failed in the last 24 hours. Admins only.
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
