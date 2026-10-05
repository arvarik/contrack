/**
 * What one contact costs to research on each provider.
 *
 * Google's figures were measured (`RESEARCH_DEPTH_FIGURES`). The Claude and
 * OpenAI figures are estimates: the same searches and tokens, at each
 * provider's list prices. The prices are pinned to the usage page's price
 * table (`server/ai/pricing.ts`), so the two cannot drift apart.
 */
import { describe, expect, it } from "vitest";
import { priceOf } from "../../../server/ai/pricing.ts";
import {
  estimateCostUsd,
  RESEARCH_DEPTH_FIGURES,
  RESEARCH_PRICES,
  RESEARCH_PROVIDERS,
} from "../../../shared/researchDepth.ts";

describe("research cost estimates", () => {
  it("prices Google's research at the measured figure, within half a cent", () => {
    for (const depth of ["standard", "deep"] as const)
      expect(
        Math.abs(
          estimateCostUsd("gemini", depth) -
            RESEARCH_DEPTH_FIGURES[depth].costUsd,
        ),
      ).toBeLessThan(0.005);
  });

  it("prices Claude and OpenAI research from the same searches and tokens", () => {
    // Standard: 5 searches at $10 per 1,000 is $0.05, and 5,300 tokens at
    // $6 per million (half input at $2, half output at $10) is $0.0318.
    // Deep: 7 searches is $0.07, and 13,000 tokens is $0.078.
    for (const provider of ["anthropic", "openai"] as const) {
      expect(estimateCostUsd(provider, "standard")).toBeCloseTo(0.0818, 6);
      expect(estimateCostUsd(provider, "deep")).toBeCloseTo(0.148, 6);
    }
  });

  it("costs Deep more than Standard on every provider", () => {
    for (const provider of RESEARCH_PROVIDERS)
      expect(estimateCostUsd(provider, "deep")).toBeGreaterThan(
        estimateCostUsd(provider, "standard"),
      );
  });

  it("uses the token prices of the usage page's table", () => {
    for (const provider of RESEARCH_PROVIDERS) {
      const { modelId, inputPerM, outputPerM } = RESEARCH_PRICES[provider];
      expect(priceOf(modelId), modelId).toEqual({
        input: inputPerM,
        output: outputPerM,
      });
    }
  });

  it("gives free searches to Google only", () => {
    // Google's Gemini 3 pricing page lists 5,000 free searches a month. The
    // Claude web search page and the OpenAI pricing page list none.
    expect(RESEARCH_PRICES.gemini.freeSearchesPerMonth).toBe(5000);
    expect(RESEARCH_PRICES.anthropic.freeSearchesPerMonth).toBeUndefined();
    expect(RESEARCH_PRICES.openai.freeSearchesPerMonth).toBeUndefined();
  });
});
