import { describe, it, expect } from "vitest";
import {
  getUpcomingBirthdayInfo,
  getUpcomingBirthdayDays,
  formatBirthdayDisplay,
  birthdayText,
} from "../../../../src/lib/birthday.ts";
import { birthdayValue, parseBirthday } from "../../../../shared/birthday.ts";

describe("parseBirthday", () => {
  it.each([
    ["1990-05-14", 1990],
    ["05-14", null],
    ["May 14", null],
    ["May 14, 1990", 1990],
    ["05/14/1990", 1990],
    ["19900514", 1990],
    // Address books: Apple's "no year" is 1604, vCard 4 drops the year.
    ["1604-05-14", null],
    ["--0514", null],
    ["--05-14", null],
    // A vCard date-time is the day written: the server's zone moved
    // 1990-05-14T00:00:00Z to May 13 west of UTC.
    ["19900514T000000Z", 1990],
    ["1990-05-14T00:00:00Z", 1990],
  ])("reads %s as May 14", (text, year) => {
    expect(parseBirthday(text)).toEqual({ year, month: 5, day: 14 });
  });

  // No month or day is invented for a year, a month or text.
  it.each([
    "1985",
    "1985-05",
    "circa 1950",
    "May 1990",
    "---14",
    "not-a-date",
    "",
    "99-99-99",
    null,
    undefined,
  ])("reads nothing in %j", (text) => {
    expect(parseBirthday(text)).toBeNull();
  });
});

describe("the next birthday", () => {
  it.each([
    // birthday, today, days until, turning, next birthday
    ["1995-01-01", [2026, 11, 31], 1, 32, [0, 1]],
    // 29 February is 1 March in a year that has none.
    ["2000-02-29", [2027, 0, 15], 45, 27, [2, 1]],
    ["2000-02-29", [2028, 0, 15], 45, 28, [1, 29]],
    ["1990-09-15", [2026, 8, 10], 5, 36, [8, 15]],
    ["09-15", [2026, 8, 10], 5, null, [8, 15]],
  ] as const)("of %s on %j", (birthday, [y, m, d], days, age, [month, day]) => {
    const info = getUpcomingBirthdayInfo(birthday, new Date(y, m, d, 10))!;
    expect(info.daysUntil).toBe(days);
    expect(info.turningAge).toBe(age);
    expect([info.nextDate.getMonth(), info.nextDate.getDate()]).toEqual([
      month,
      day,
    ]);
  });

  it("is upcoming within 30 days", () => {
    const now = new Date(2026, 8, 10);
    expect(getUpcomingBirthdayDays("1990-09-15", now)).toBe(5);
    expect(getUpcomingBirthdayDays("1990-11-15", now)).toBeNull();
  });
});

describe("the birthday editor's text", () => {
  it("keeps a day with no year year-less, on the way in and out", () => {
    // It opened as 2001, and a save kept that year.
    expect(birthdayText("05-14")).toBe("May 14");
    expect(birthdayText("1990-05-14")).toBe("May 14, 1990");
    expect(birthdayValue(parseBirthday("May 14")!)).toBe("05-14");
    expect(birthdayValue(parseBirthday("May 14, 1990")!)).toBe("1990-05-14");
  });

  it("shows no year for Apple's year-less 1604", () => {
    expect(formatBirthdayDisplay("1990-05-14")).toContain("May");
    expect(formatBirthdayDisplay("1604-05-14")).not.toMatch(/\d{4}/);
    expect(formatBirthdayDisplay(null)).toBeNull();
  });
});
