/**
 * Reading and showing the dates the API sends.
 *
 * The contact page shows one date format: `formatDay` for a day, `formatWhen`
 * for a day and a time. Both read through `parseServerTime`, so the three
 * shapes the database holds must land on the right calendar day.
 */
import { describe, expect, it } from "vitest";
import {
  describePastDue,
  formatDay,
  formatWhen,
  parseServerTime,
} from "../../src/lib/datetime";

describe("parseServerTime", () => {
  it("reads a JavaScript timestamp and a SQLite timestamp as the same instant", () => {
    const js = parseServerTime("2026-09-10T05:33:50.000Z");
    const sqlite = parseServerTime("2026-09-10 05:33:50");
    expect(js?.toISOString()).toBe("2026-09-10T05:33:50.000Z");
    expect(sqlite?.toISOString()).toBe("2026-09-10T05:33:50.000Z");
  });

  it("reads a date with no time as that day on the local calendar", () => {
    const birthday = parseServerTime("1974-05-10");
    expect(birthday?.getFullYear()).toBe(1974);
    expect(birthday?.getMonth()).toBe(4);
    expect(birthday?.getDate()).toBe(10);
    expect(birthday?.getHours()).toBe(0);
  });

  it("returns null for nothing and for text that is not a date", () => {
    expect(parseServerTime(null)).toBeNull();
    expect(parseServerTime("")).toBeNull();
    expect(parseServerTime("not a date")).toBeNull();
  });
});

describe("formatDay and formatWhen", () => {
  it("show a date-only value on its own day", () => {
    const expected = new Date(1974, 4, 10).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    expect(formatDay("1974-05-10")).toBe(expected);
  });

  it("fall back to the given text when there is no date", () => {
    expect(formatDay(null, "No date")).toBe("No date");
    expect(formatWhen("garbage")).toBe("Unknown");
  });
});

describe("describePastDue", () => {
  it("counts days for two weeks, then weeks, then months", () => {
    expect(describePastDue(1)).toBe("1 day past due");
    expect(describePastDue(12)).toBe("12 days past due");
    expect(describePastDue(21)).toBe("3 weeks past due");
    expect(describePastDue(70)).toBe("2 months past due");
  });

  it("never says less than a day", () => {
    expect(describePastDue(0)).toBe("1 day past due");
    expect(describePastDue(0.4)).toBe("1 day past due");
  });
});
