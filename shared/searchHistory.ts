// Search history: the values the browser needs. No zod here: the browser
// loads this on the first page. The routes' schemas are in `searchSchemas.ts`.

export const HISTORY_MODES = ["people", "notes", "palette"] as const;
export type HistoryMode = (typeof HISTORY_MODES)[number];
export type { HistoryEntry, RecordHistoryInput } from "./searchSchemas.ts";

/**
 * A query for indexing and history deduplication: lower case, trimmed, runs
 * of whitespace as one space, and no leading "? " (the palette's AI prefix).
 */
export function normalizeQuery(raw: string): string {
  const stripped = raw.replace(/^\s*\?\s+/, "");
  return stripped.replace(/\s+/g, " ").trim().toLowerCase();
}
