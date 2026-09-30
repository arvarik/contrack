// @vitest-environment jsdom
/**
 * The question mark beside "Research depth": what one contact costs on Google,
 * Claude and OpenAI. It is an `InfoTip`, so it opens on a press and on focus,
 * and its words stay in the page for a screen reader.
 */
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DepthCostTip } from "../../../../src/views/ai-search/DepthCostTip";
import { dollars } from "../../../../src/lib/researchDepth";
import {
  estimateCostUsd,
  RESEARCH_PRICES,
  RESEARCH_PROVIDERS,
} from "../../../../shared/researchDepth";

afterEach(cleanup);

/** The tip's words, whether or not it is open. */
const panel = () => screen.getByRole("tooltip", { hidden: true });
const block = (provider: string) =>
  panel().querySelector(`[data-provider="${provider}"]`)!;

describe("the research cost tip", () => {
  it("is a question mark button named for what it says", () => {
    render(<DepthCostTip />);
    expect(
      screen.getByRole("button", { name: "Estimated research costs" }),
    ).toBeTruthy();
  });

  it("opens on a press", () => {
    render(<DepthCostTip />);
    expect(panel().hidden).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Estimated research costs" }),
    );
    expect(panel().hidden).toBe(false);
  });

  it("names the year of the prices", () => {
    render(<DepthCostTip />);
    expect(panel().textContent).toContain("2026");
  });

  it("gives each provider its model and both depths", () => {
    render(<DepthCostTip />);
    for (const provider of RESEARCH_PROVIDERS) {
      const text = block(provider).textContent ?? "";
      expect(text, provider).toContain(RESEARCH_PRICES[provider].modelLabel);
      expect(text, provider).toContain(
        `Standard ${dollars(estimateCostUsd(provider, "standard"))}`,
      );
      expect(text, provider).toContain(
        `Deep ${dollars(estimateCostUsd(provider, "deep"))}`,
      );
    }
  });

  it("gives each provider its token and search prices", () => {
    render(<DepthCostTip />);
    expect(block("gemini").textContent).toContain(
      "$0.75 in, $3.75 out per 1M tokens",
    );
    expect(block("gemini").textContent).toContain("$14 per 1,000 searches");
    for (const provider of ["anthropic", "openai"])
      expect(block(provider).textContent).toContain(
        "$2 in, $10 out per 1M tokens. $10 per 1,000 searches",
      );
  });

  it("says the first 5,000 searches a month are free for Google only", () => {
    render(<DepthCostTip />);
    expect(block("gemini").textContent).toContain(
      "The first 5,000 searches a month are free",
    );
    expect(block("anthropic").textContent).not.toMatch(/free/i);
    expect(block("openai").textContent).not.toMatch(/free/i);
  });

  it("says which figures were measured and which are estimates", () => {
    render(<DepthCostTip />);
    expect(panel().textContent).toContain(
      "Google's figures were measured. The others are estimates",
    );
  });
});
