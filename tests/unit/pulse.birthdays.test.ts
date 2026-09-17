import { describe, it, expect } from "vitest";
import {
  parseBirthday,
  getUpcomingBirthdayInfo,
  getUpcomingBirthdayDays,
  toBirthdayInputValue,
  formatBirthdayDisplay,
} from "../../src/lib/birthday.ts";

describe("pulse.birthdays parseBirthday", () => {
  it("parses YYYY-MM-DD", () => {
    expect(parseBirthday("1990-05-14")).toEqual({
      year: 1990,
      month: 5,
      day: 14,
    });
  });

  it("parses MM-DD without year", () => {
    expect(parseBirthday("05-14")).toEqual({
      year: null,
      month: 5,
      day: 14,
    });
  });

  it("parses May 14 without year", () => {
    expect(parseBirthday("May 14")).toEqual({
      year: null,
      month: 5,
      day: 14,
    });
  });

  it("parses May 14, 1990 with year", () => {
    expect(parseBirthday("May 14, 1990")).toEqual({
      year: 1990,
      month: 5,
      day: 14,
    });
  });

  it("ignores unparseable strings", () => {
    expect(parseBirthday("not-a-date")).toBeNull();
    expect(parseBirthday("")).toBeNull();
    expect(parseBirthday("99-99-99")).toBeNull();
    expect(parseBirthday(null)).toBeNull();
    expect(parseBirthday(undefined)).toBeNull();
  });
});

describe("pulse.birthdays upcoming calculations", () => {
  it("computes a birthday tomorrow across a year boundary", () => {
    // Current date: Dec 31, 2026
    const now = new Date(2026, 11, 31, 10, 0); // 2026-12-31
    const info = getUpcomingBirthdayInfo("1995-01-01", now);
    expect(info).not.toBeNull();
    expect(info?.daysUntil).toBe(1);
    expect(info?.turningAge).toBe(32); // 2027 - 1995 = 32
  });

  it("treats 29 February on a non-leap year as 1 March", () => {
    // 2027 is not a leap year.
    const now = new Date(2027, 0, 15); // 2027-01-15
    const info = getUpcomingBirthdayInfo("2000-02-29", now);
    expect(info).not.toBeNull();
    // 2027-03-01 is the birthday date
    expect(info?.nextDate.getMonth()).toBe(2); // 0-indexed March = 2
    expect(info?.nextDate.getDate()).toBe(1);
    expect(info?.turningAge).toBe(27); // 2027 - 2000 = 27
  });

  it("keeps 29 February on a leap year", () => {
    // 2028 is a leap year.
    const now = new Date(2028, 0, 15); // 2028-01-15
    const info = getUpcomingBirthdayInfo("2000-02-29", now);
    expect(info).not.toBeNull();
    expect(info?.nextDate.getMonth()).toBe(1); // February = 1
    expect(info?.nextDate.getDate()).toBe(29);
    expect(info?.turningAge).toBe(28); // 2028 - 2000 = 28
  });

  it("returns turning N only with a year", () => {
    const now = new Date(2026, 8, 10); // 2026-09-10
    const withYear = getUpcomingBirthdayInfo("1990-09-15", now);
    expect(withYear?.daysUntil).toBe(5);
    expect(withYear?.turningAge).toBe(36); // 2026 - 1990 = 36

    const withoutYear = getUpcomingBirthdayInfo("09-15", now);
    expect(withoutYear?.daysUntil).toBe(5);
    expect(withoutYear?.turningAge).toBeNull();
  });

  it("computes getUpcomingBirthdayDays within 30 days", () => {
    const now = new Date(2026, 8, 10);
    expect(getUpcomingBirthdayDays("1990-09-15", now)).toBe(5);
    expect(getUpcomingBirthdayDays("1990-11-15", now)).toBeNull(); // > 30 days
  });
});

describe("toBirthdayInputValue and formatDisplay", () => {
  it("normalizes to YYYY-MM-DD when year is known", () => {
    expect(toBirthdayInputValue("1990-05-14")).toBe("1990-05-14");
    expect(toBirthdayInputValue("May 14, 1990")).toBe("1990-05-14");
  });

  it("formats display cleanly", () => {
    expect(formatBirthdayDisplay("1990-05-14")).toContain("May");
    expect(formatBirthdayDisplay(null)).toBeNull();
  });
});
