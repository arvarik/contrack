/**
 * The schemas for the streamed answers the app checks line by line: the
 * People search (`useSemanticSearch`) and the brief over its results
 * (`SynthesisBar`). Their readers import this module when they ask, so zod
 * is not on the first page load.
 */
import { z } from "zod";

/** One line of the People search stream. */
export const searchChunkSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.enum(["instant", "enriched", "complete"]),
    matches: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            verified: z.boolean().optional(),
          })
          .passthrough(),
      )
      .max(30),
    fallback: z.boolean(),
    total: z.number().int().nonnegative().optional(),
    facets: z.string().optional(),
    refine: z
      .array(
        z.object({
          facet: z.string(),
          label: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .max(10)
      .optional(),
  }),
  z.object({ phase: z.literal("error"), error: z.string() }),
]);

/** The longest summary, whole or as the sum of its deltas. */
export const MAX_SUMMARY_LENGTH = 20_000;

/** One line of the brief. A delta carries the next piece, not the whole text. */
export const synthesisChunkSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("start") }),
  z.object({ phase: z.literal("delta"), text: z.string() }),
  z.object({
    phase: z.literal("complete"),
    text: z.string().trim().min(1).max(MAX_SUMMARY_LENGTH),
  }),
  z.object({ phase: z.literal("error"), error: z.string() }),
]);
