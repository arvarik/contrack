/**
 * An `aiBriefing` JSON string as a string array. Never throws: a model wrote
 * the field, so it may be malformed, and that reads as an empty array.
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
