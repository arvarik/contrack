// =============================================================================
// Safe Parse Utilities
// =============================================================================
// Defensive JSON parsers that never throw. Protects against malformed data
// in AI-generated fields (aiBriefing, aiSummary, etc.).
// =============================================================================

/**
 * Safely parse an aiBriefing JSON string into a string array.
 * Returns empty array on null, undefined, or malformed JSON.
 */
export function parseBriefingPoints(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      return parsed.filter((p): p is string => typeof p === "string");
    return [];
  } catch {
    return [];
  }
}
