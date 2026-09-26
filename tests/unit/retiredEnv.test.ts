import { describe, it, expect } from "vitest";
import { RETIRED_ENV, warnRetiredEnv } from "../../server/utils/retiredEnv.ts";

describe("warnRetiredEnv", () => {
  it("names each retired variable that is set", () => {
    expect(warnRetiredEnv({ AI_TIER: "PAID", PORT: "3210" })).toEqual([
      "AI_TIER",
    ]);
  });

  it("ignores one that is empty or absent", () => {
    expect(warnRetiredEnv({ AI_TIER: "" })).toEqual([]);
    expect(warnRetiredEnv({})).toEqual([]);
  });

  it("says what to do instead for every entry", () => {
    for (const advice of Object.values(RETIRED_ENV))
      expect(advice.length).toBeGreaterThan(20);
  });
});
