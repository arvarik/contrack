// The search routes' request schemas: the facets a search carries, and the
// search history. Apart from `searchFacets.ts` and `searchHistory.ts`,
// which the browser loads on the first page without zod.

import { z } from "zod";
import { FACET_FIELDS } from "./searchFacets.ts";
import { HISTORY_MODES } from "./searchHistory.ts";

/**
 * The facets a search request may carry, as `GET /api/search` and
 * `POST /api/search/semantic` accept them: at most 8. A `near:` facet
 * carries its resolved `point`. Fields the palette keeps for itself, such as
 * `resolving`, are dropped.
 */
export const facetFiltersSchema = z
  .array(
    z
      .object({
        field: z.enum(FACET_FIELDS),
        value: z.string().trim().min(1).max(100),
        operator: z.enum([">", "<"]).optional(),
        km: z.number().positive().max(20_000).optional(),
        point: z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            km: z.number().positive().max(20_000),
          })
          .optional(),
      })
      .transform((f) => {
        if (
          !f.operator &&
          (f.field === "score" ||
            f.field === "updated" ||
            f.field === "added" ||
            f.field === "contacted") &&
          (f.value.startsWith(">") || f.value.startsWith("<")) &&
          f.value.length > 1
        ) {
          return {
            ...f,
            operator: f.value[0] as ">" | "<",
            value: f.value.slice(1).trim(),
          };
        }
        return f;
      }),
  )
  .max(8);

export const historyModeSchema = z.enum(HISTORY_MODES);

const historyEntrySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  mode: historyModeSchema,
  query: z.string(),
  normalizedQuery: z.string(),
  resultCount: z.number().int().nullable(),
  resultIds: z.array(z.string()),
  fallback: z.boolean(),
  pinned: z.boolean(),
  runCount: z.number().int(),
  createdAt: z.string(),
  lastRunAt: z.string(),
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** POST /api/search/history body schema */
export const recordHistorySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "query cannot be empty")
    .max(500, "query must be ≤ 500 characters"),
  mode: historyModeSchema,
  resultCount: z.number().int().min(0).nullable().optional(),
  resultIds: z.array(z.string()).optional(),
  fallback: z.boolean().optional(),
});

export type RecordHistoryInput = z.infer<typeof recordHistorySchema>;

/** PATCH /api/search/history/:id body schema */
export const patchHistorySchema = z
  .object({
    pinned: z.boolean(),
  })
  .strict();

/** GET /api/search/history query parameters schema */
export const listHistoryQuerySchema = z.object({
  mode: historyModeSchema.optional(),
  q: z.string().optional(),
  pinned: z.preprocess((val) => {
    if (val === "1" || val === "true" || val === 1 || val === true) return true;
    if (val === "0" || val === "false" || val === 0 || val === false)
      return false;
    return undefined;
  }, z.boolean().optional()),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
