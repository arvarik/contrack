import { describe, it, expect } from "vitest";
import { isoWeekStart, weekStartsOn } from "../../shared/dates.ts";

describe("isoWeekStart", () => {
  it("treats Monday as itself", () => {
    expect(isoWeekStart("2026-09-14")).toBe("2026-09-14");
    expect(isoWeekStart(new Date(2026, 8, 14))).toBe("2026-09-14");
  });

  it("maps Sunday to the previous Monday", () => {
    expect(isoWeekStart("2026-09-20")).toBe("2026-09-14");
    expect(isoWeekStart(new Date(2026, 8, 20))).toBe("2026-09-14");
  });

  it("maps midweek days to the current week's Monday", () => {
    expect(isoWeekStart("2026-09-15")).toBe("2026-09-14"); // Tuesday
    expect(isoWeekStart("2026-09-16")).toBe("2026-09-14"); // Wednesday
    expect(isoWeekStart("2026-09-17")).toBe("2026-09-14"); // Thursday
    expect(isoWeekStart("2026-09-18")).toBe("2026-09-14"); // Friday
    expect(isoWeekStart("2026-09-19")).toBe("2026-09-14"); // Saturday
  });

  it("handles a Sunday across a year boundary", () => {
    // 2023-01-01 was a Sunday; its ISO week started on 2022-12-26 (Monday)
    expect(isoWeekStart("2023-01-01")).toBe("2022-12-26");
    expect(isoWeekStart(new Date(2023, 0, 1))).toBe("2022-12-26");
  });

  it("handles a Saturday at the end of the year", () => {
    // 2022-12-31 was a Saturday; its ISO week started on 2022-12-26 (Monday)
    expect(isoWeekStart("2022-12-31")).toBe("2022-12-26");
  });

  it("handles the first Monday of a new year", () => {
    // 2023-01-02 was a Monday
    expect(isoWeekStart("2023-01-02")).toBe("2023-01-02");
  });
});

describe("weekStartsOn", () => {
  it("returns 1 for monday and 0 for sunday", () => {
    expect(weekStartsOn("monday")).toBe(1);
    expect(weekStartsOn("sunday")).toBe(0);
    expect(weekStartsOn()).toBe(1);
  });
});
