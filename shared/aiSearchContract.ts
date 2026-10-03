import { z } from "zod";
import { researchDepthSchema } from "./researchDepth.ts";

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
        /**
         * What a finished job found: new details, nothing the contact did
         * not already have, or no page about this person at all.
         */
        outcome: z.enum(["added", "nothing-new", "no-public-info"]).optional(),
        /** The models that ran, search pass first. */
        models: z.array(z.string().max(120)).max(4).optional(),
        /** How thoroughly this contact is researched. */
        depth: researchDepthSchema.optional(),
        /**
         * How this contact is searched: "two-pass" with the research
         * model's own search, "searxng", or "combined" for both. A job that
         * joins a running batch keeps its own.
         */
        strategy: z.string().max(40).optional(),
        /**
         * The research technique this contact runs: "provider-search",
         * "search-and-read" or "combined". `strategy` names the same choice
         * in its older words.
         */
        technique: z.string().max(40).optional(),
        /** The web search the technique searches with, such as "searxng". */
        webSearch: z.string().max(40).optional(),
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
