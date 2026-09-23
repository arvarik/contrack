/**
 * The map counts a follow-up as overdue by the calendar day, as the contact
 * page's banner does.
 *
 * It compared instants. At 6 PM in Los Angeles a follow-up set to
 * "Tomorrow" (`2026-09-23`) counted as one overdue, because
 * `new Date("2026-09-23")` is UTC midnight, 5 PM the day before in
 * California. And SQLite's `2026-09-22 10:00:00` is UTC, which `new Date()`
 * read as local time. The zone is pinned to Los Angeles here, where both
 * mistakes show, and `now` is fixed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  calendarDaysBetween,
  isPastDay,
  parseServerTime,
} from "../../shared/dates";
import { toFeatureCollection, type MapContact } from "../../shared/geo";
import { computeMapStats } from "../../src/views/map/mapStats";

beforeAll(() => {
  vi.stubEnv("TZ", "America/Los_Angeles");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** 6 PM on Tuesday, September 22, 2026, in Los Angeles (PDT, UTC-7). */
const SIX_PM = new Date("2026-09-23T01:00:00.000Z");

const pin = (id: string, nextFollowUpAt: string | null): MapContact => ({
  id,
  name: id,
  company: null,
  location: "Los Angeles, CA",
  avatarUrl: null,
  lat: 34.05,
  lng: -118.24,
  isTracked: true,
  nextFollowUpAt,
});

describe("overdue on the map", () => {
  it("runs in Los Angeles", () => {
    expect(SIX_PM.getHours()).toBe(18);
    expect(SIX_PM.getDate()).toBe(22);
  });

  it("counts a follow-up only once its day is before today", () => {
    const pins = [
      pin("tomorrow", "2026-09-23"),
      pin("today, as SQLite writes it", "2026-09-22 10:00:00"),
      pin("today, a date", "2026-09-22"),
      pin("yesterday", "2026-09-21"),
      pin("late last night", "2026-09-22T06:59:00.000Z"),
      pin("none", null),
    ];
    expect(computeMapStats(pins, null, SIX_PM).overdue).toBe(2);
    const overdue = toFeatureCollection(pins, SIX_PM)
      .features.filter((f) => f.properties.overdue === 1)
      .map((f) => f.id);
    expect(overdue).toEqual(["yesterday", "late last night"]);
  });

  it("agrees with isPastDay, the rule the banner's days come from", () => {
    expect(isPastDay("2026-09-23", SIX_PM)).toBe(false);
    expect(isPastDay("2026-09-22 10:00:00", SIX_PM)).toBe(false);
    expect(isPastDay("2026-09-21", SIX_PM)).toBe(true);
    expect(isPastDay(null, SIX_PM)).toBe(false);
    expect(isPastDay("not a date", SIX_PM)).toBe(false);
  });
});

describe("calendarDaysBetween", () => {
  it("counts days on the local calendar, whatever the time of day", () => {
    const due = parseServerTime("2026-09-23")!;
    expect(calendarDaysBetween(SIX_PM, due)).toBe(1);
    expect(calendarDaysBetween(due, SIX_PM)).toBe(-1);
    expect(calendarDaysBetween(SIX_PM, SIX_PM)).toBe(0);
  });

  it("does not lose or gain a day where the clocks change", () => {
    // Daylight saving time ends in Los Angeles on November 1, 2026.
    const before = new Date(2026, 9, 31, 12, 0);
    const after = new Date(2026, 10, 2, 0, 30);
    expect(calendarDaysBetween(before, after)).toBe(2);
  });

  it("tells the calendar from two shortcuts that pass the case above", () => {
    // Two wrong ways to count, and the case that catches each.
    const roundedInstants = (from: Date, to: Date) =>
      Math.round((to.getTime() - from.getTime()) / 86_400_000);
    const midnight = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const flooredMidnights = (from: Date, to: Date) =>
      Math.floor((midnight(to) - midnight(from)) / 86_400_000);

    // Across the spring change, March 8: noon to noon two days later is 47
    // hours, and so is midnight to midnight.
    const saturdayNoon = new Date(2026, 2, 7, 12, 0);
    const mondayNoon = new Date(2026, 2, 9, 12, 0);
    expect(calendarDaysBetween(saturdayNoon, mondayNoon)).toBe(2);
    expect(flooredMidnights(saturdayNoon, mondayNoon)).toBe(1);

    // The fall change day is 25 hours long: 00:30 to 23:30 on November 1
    // is 24 hours, on the same day.
    const early = new Date(2026, 10, 1, 0, 30);
    const late = new Date(2026, 10, 1, 23, 30);
    expect(calendarDaysBetween(early, late)).toBe(0);
    expect(roundedInstants(early, late)).toBe(1);
  });
});
