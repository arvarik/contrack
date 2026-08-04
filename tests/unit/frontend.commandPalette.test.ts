import { describe, it, expect } from "vitest";
import {
  getMode,
  stripModePrefix,
} from "../../src/components/command-palette/utils";

describe("getMode", () => {
  it("returns 'normal' for plain search text", () => {
    expect(getMode("jane doe")).toBe("normal");
    expect(getMode("")).toBe("normal");
  });

  it("returns 'ai' when the query starts with ?", () => {
    expect(getMode("?who do I know in London")).toBe("ai");
  });

  it("returns 'action' when the query starts with >", () => {
    expect(getMode(">archive")).toBe("action");
  });

  it("ignores leading whitespace before the prefix", () => {
    expect(getMode("   ?query")).toBe("ai");
    expect(getMode("   >action")).toBe("action");
    expect(getMode("   plain")).toBe("normal");
  });

  it("treats a prefix character mid-string as normal", () => {
    expect(getMode("what?")).toBe("normal");
    expect(getMode("a > b")).toBe("normal");
  });
});

describe("stripModePrefix", () => {
  it("strips the ? prefix", () => {
    expect(stripModePrefix("? who is jane")).toBe("who is jane");
  });

  it("strips the > prefix", () => {
    expect(stripModePrefix(">archive contact")).toBe("archive contact");
  });

  it("leaves plain queries untouched (trimmed)", () => {
    expect(stripModePrefix("  jane doe  ")).toBe("jane doe");
  });
});
