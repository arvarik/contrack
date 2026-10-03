// =============================================================================
// Unit: the strategies a batch start names
// =============================================================================
// The app starts a batch with a strategy: "two-pass", "searxng" or
// "combined". Each one stands for a technique and a web search, and a job
// names its choice with the same strategy again.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  STRATEGY_CHOICE,
  strategyOf,
} from "../../../../server/services/research/index.ts";

describe("research strategies", () => {
  it("name a technique and a web search, and a job's choice names its strategy again", () => {
    expect(STRATEGY_CHOICE["two-pass"]).toEqual({
      technique: "provider-search",
    });
    expect(STRATEGY_CHOICE.searxng).toEqual({
      technique: "search-and-read",
      webSearch: "searxng",
    });
    for (const [strategy, choice] of Object.entries(STRATEGY_CHOICE))
      expect(strategyOf(choice)).toBe(strategy);
  });
});
