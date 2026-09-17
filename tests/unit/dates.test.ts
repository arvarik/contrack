import { describe, it, expect } from "vitest";
import { weekStartsOn } from "../../shared/dates";

describe("weekStartsOn", () => {
  it("returns 1 for monday", () => {
    expect(weekStartsOn("monday")).toBe(1);
  });

  it("returns 0 for sunday", () => {
    expect(weekStartsOn("sunday")).toBe(0);
  });
});
