import { z } from "zod";

export const HISTORY_MODES = ["people", "notes", "palette"] as const;
export const historyModeSchema = z.enum(HISTORY_MODES);
export type HistoryMode = z.infer<typeof historyModeSchema>;

export const historyEntrySchema = z.object({
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
export const postHistorySchema = recordHistorySchema;
export const createHistorySchema = recordHistorySchema;

/** PATCH /api/search/history/:id body schema */
export const patchHistorySchema = z
  .object({
    pinned: z.boolean(),
  })
  .strict();

export type PatchHistoryInput = z.infer<typeof patchHistorySchema>;

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

export type ListHistoryQuery = z.infer<typeof listHistoryQuerySchema>;

/**
 * Normalise a query for indexing and history deduplication:
 * - Lowercase
 * - Trim leading/trailing whitespace
 * - Collapse consecutive whitespace to a single space
 * - Strip a leading "? " (e.g. palette AI search prefix)
 */
export function normalizeQuery(raw: string): string {
  const stripped = raw.replace(/^\s*\?\s+/, "");
  return stripped.replace(/\s+/g, " ").trim().toLowerCase();
}
