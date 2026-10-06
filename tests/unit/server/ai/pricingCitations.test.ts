// Unit: model prices and research sources

import { describe, it, expect } from "vitest";
import { blendedCostPerM, priceOf } from "../../../../server/ai/pricing.ts";
import { toCitations } from "../../../../server/ai/citations.ts";

describe("priceOf", () => {
  it("finds a dated snapshot under its alias", () => {
    // The usage page priced every Anthropic call at nothing: its rows were
    // keyed "claude-haiku-4.5", and the id a request names is this one.
    expect(priceOf("claude-haiku-4-5-20251001")).toEqual({
      input: 1,
      output: 5,
    });
    expect(priceOf("models/gemini-3.8-flash")).toBeDefined();
  });

  it("knows the current lineups", () => {
    for (const id of [
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-6.1-sol",
      "gpt-6-astra",
      "claude-sonnet-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "gemini-3.5-flash-lite",
    ])
      expect(priceOf(id), id).toBeDefined();
  });

  it("prices an unknown model at nothing rather than a guess", () => {
    expect(blendedCostPerM("some-future-model")).toBe(0);
  });

  it("blends three parts input to one part output", () => {
    // Sonnet 5: $2 in, $10 out → (3 × 2 + 10) / 4 = 4.
    expect(blendedCostPerM("claude-sonnet-5")).toBe(4);
  });
});

describe("toCitations", () => {
  it("keeps http(s) pages once each, and names a bare URL by its host", () => {
    expect(
      toCitations([
        { url: "https://www.example.com/a" },
        { url: "https://www.example.com/a", title: "Again" },
        { url: "http://news.example.org/b", title: "  News  " },
        { url: "javascript:alert(1)" },
        { url: "https://user:pass@example.com/secret" },
        { url: "not a url" },
        { url: null },
      ]),
    ).toEqual([
      { title: "example.com", uri: "https://www.example.com/a" },
      { title: "News", uri: "http://news.example.org/b" },
    ]);
  });

  it("stops at thirty", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      url: `https://example.com/${i}`,
    }));
    expect(toCitations(many)).toHaveLength(30);
  });
});
