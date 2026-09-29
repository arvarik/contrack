import { describe, it, expect } from "vitest";
import { computeStreak } from "../../../shared/pulse.ts";

describe("pulse.streak computeStreak", () => {
  const now = new Date(2026, 8, 17, 14, 30); // 2026-09-17 14:30 local time
  // today = 2026-09-17, yesterday = 2026-09-16

  // computeStreak counts local days, so each timestamp is a local hour. A
  // fixed UTC hour falls on another day in Honolulu or Kiritimati.
  const local = (month: number, day: number, hour: number) =>
    new Date(2026, month - 1, day, hour).toISOString();

  it("returns 0 and null for empty interactions", () => {
    const res = computeStreak([], now);
    expect(res).toEqual({ current: 0, best: 0, lastDay: null });
  });

  it("counts consecutive days ending today as current", () => {
    const interactions = [
      { date: local(9, 15, 10), type: "note" },
      { date: local(9, 16, 12), type: "call" },
      { date: local(9, 17, 9), type: "meeting" },
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 3, best: 3, lastDay: "2026-09-17" });
  });

  it("treats consecutive days ending yesterday as still current", () => {
    const interactions = [
      { date: local(9, 14, 10), type: "note" },
      { date: local(9, 15, 10), type: "note" },
      { date: local(9, 16, 12), type: "call" },
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 3, best: 3, lastDay: "2026-09-16" });
  });

  it("resets current streak when there is a gap before yesterday", () => {
    const interactions = [
      { date: local(9, 13, 10), type: "note" },
      { date: local(9, 14, 10), type: "note" },
      { date: local(9, 15, 12), type: "call" },
      // 2026-09-16 (yesterday) is missing
      // 2026-09-17 (today) is missing
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 0, best: 3, lastDay: "2026-09-15" });
  });

  it("keeps the best streak across history even if current streak is shorter or 0", () => {
    const interactions = [
      // Past 5-day streak
      { date: local(8, 1, 10), type: "note" },
      { date: local(8, 2, 10), type: "note" },
      { date: local(8, 3, 10), type: "note" },
      { date: local(8, 4, 10), type: "note" },
      { date: local(8, 5, 10), type: "note" },
      // Gap
      // Current 2-day streak ending today
      { date: local(9, 16, 10), type: "note" },
      { date: local(9, 17, 10), type: "note" },
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 2, best: 5, lastDay: "2026-09-17" });
  });

  it("excludes days with only import rows", () => {
    const interactions = [
      { date: local(9, 16, 10), type: "import" },
      { date: local(9, 17, 10), type: "note" },
    ];
    const res = computeStreak(interactions, now);
    // 2026-09-16 only had import, so only 2026-09-17 counts (streak = 1)
    expect(res).toEqual({ current: 1, best: 1, lastDay: "2026-09-17" });
  });

  it("excludes days where source is non-null", () => {
    const interactions = [
      { date: local(9, 16, 10), type: "note", source: "google_calendar" },
      { date: local(9, 17, 10), type: "note", source: null },
    ];
    const res = computeStreak(interactions, now);
    // 2026-09-16 had source set, so only 2026-09-17 counts (streak = 1)
    expect(res).toEqual({ current: 1, best: 1, lastDay: "2026-09-17" });
  });

  it("counts a day if it has at least one valid manual row among import/source rows", () => {
    const interactions = [
      { date: local(9, 16, 8), type: "import" },
      { date: local(9, 16, 9), type: "note", source: "imap" },
      { date: local(9, 16, 10), type: "note", source: null }, // valid!
      { date: local(9, 17, 10), type: "call" }, // valid!
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 2, best: 2, lastDay: "2026-09-17" });
  });

  it("computes the day boundary according to the server's local day", () => {
    // 2026-09-17 at 23:55 local time
    const lateToday = new Date(2026, 8, 17, 23, 55);
    const interactions = [{ date: lateToday.toISOString(), type: "note" }];
    const res = computeStreak(interactions, lateToday);
    expect(res.current).toBe(1);
    expect(res.lastDay).toBe("2026-09-17");
  });
});
