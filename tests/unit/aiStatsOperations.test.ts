// =============================================================================
// Regression: the AI stats feed filter must accept every recorded operation.
// The route previously kept its own hand-written copy of the operation list,
// which drifted (queryParse / hyde / aiSearchSinglePass were recorded but
// rejected by the filter with a 400).
// =============================================================================

import { describe, it, expect } from "vitest";
import { AI_OPERATIONS } from "../../server/services/aiStatsService.ts";

describe("AI_OPERATIONS canonical list", () => {
  it("contains every operation the services record", () => {
    for (const op of [
      "briefing",
      "rerank",
      "mentions",
      "synthesis",
      "parse",
      "searchExpansion",
      "dailyInsight",
      "emlSummary",
      "bulkParse",
      "aiSearchGrounding",
      "aiSearchExtraction",
      "aiSearchSinglePass",
      "queryParse",
      "hyde",
    ]) {
      expect(AI_OPERATIONS).toContain(op);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(AI_OPERATIONS).size).toBe(AI_OPERATIONS.length);
  });
});
