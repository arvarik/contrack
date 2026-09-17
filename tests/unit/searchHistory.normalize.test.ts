import { describe, it, expect } from "vitest";
import { normalizeQuery } from "../../shared/searchHistory.ts";

describe("normalizeQuery", () => {
  it("lowercases text", () => {
    expect(normalizeQuery("Hello World")).toBe("hello world");
    expect(normalizeQuery("WHO LIKES ESPRESSO")).toBe("who likes espresso");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeQuery("   san francisco   ")).toBe("san francisco");
    expect(normalizeQuery("\t  berlin \n")).toBe("berlin");
  });

  it("collapses multiple consecutive whitespace characters", () => {
    expect(normalizeQuery("who    works    at   google")).toBe(
      "who works at google",
    );
    expect(normalizeQuery("met  \t at \n  conference")).toBe(
      "met at conference",
    );
  });

  it("strips a leading '? ' prefix", () => {
    expect(normalizeQuery("? who likes tea")).toBe("who likes tea");
    expect(normalizeQuery("?   who likes tea")).toBe("who likes tea");
    expect(normalizeQuery("  ?  who likes tea  ")).toBe("who likes tea");
  });

  it("preserves question marks when not a '? ' prefix", () => {
    expect(normalizeQuery("who likes coffee?")).toBe("who likes coffee?");
    expect(normalizeQuery("?who")).toBe("?who");
    expect(normalizeQuery("?")).toBe("?");
  });

  it("reduces '? ' with only spaces to empty string", () => {
    expect(normalizeQuery("? ")).toBe("");
    expect(normalizeQuery("  ?   ")).toBe("");
  });

  it("handles empty string", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery("   ")).toBe("");
  });
});
