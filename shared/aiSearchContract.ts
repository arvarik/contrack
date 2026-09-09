import { z } from "zod";

/** Shared status contract for batch polling, live updates, and cancellation. */
export const aiSearchBatchSchema = z.object({
  id: z.string().min(1).max(100),
  strategy: z.string(),
  createdAt: z.string(),
  status: z.enum(["processing", "complete", "cancelled"]),
  totalTokens: z.number().finite().nonnegative(),
  jobs: z
    .array(
      z.object({
        id: z.string(),
        contactId: z.string(),
        contactName: z.string(),
        status: z.enum([
          "queued",
          "searching",
          "merging",
          "success",
          "error",
          "cancelled",
        ]),
        error: z.string().optional(),
        errorType: z
          .enum([
            "rate_limit",
            "validation",
            "network",
            "auth",
            "ambiguous",
            "unknown",
          ])
          .optional(),
        fieldsUpdated: z.number().int().nonnegative(),
        startedAt: z.string().optional(),
        completedAt: z.string().optional(),
        latencyMs: z.number().nonnegative().optional(),
      }),
    )
    .max(100),
});

export type AISearchBatch = z.infer<typeof aiSearchBatchSchema>;
export type AISearchJob = AISearchBatch["jobs"][number];
export type AISearchJobStatus = AISearchJob["status"];
export type AISearchErrorType = NonNullable<AISearchJob["errorType"]>;
