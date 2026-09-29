// =============================================================================
// Unit: which research strategy runs
// =============================================================================
// Two-pass keeps a source beside every fact, so it is the default on every
// provider. Single-pass stays available by name.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  getDefaultStrategyForProvider,
  getStrategy,
} from "../../../../server/services/aiSearch/strategies/index.ts";

describe("research strategies", () => {
  it("finds single-pass by name", () => {
    expect(getStrategy("single-pass").name).toBe("single-pass");
  });

  it("defaults every provider to two-pass, and no provider too when no SearXNG is set", () => {
    expect(getDefaultStrategyForProvider("openai")).toBe("two-pass");
    expect(getDefaultStrategyForProvider("anthropic")).toBe("two-pass");
    expect(getDefaultStrategyForProvider("gemini")).toBe("two-pass");
    expect(getDefaultStrategyForProvider(null)).toBe("two-pass");
  });
});
