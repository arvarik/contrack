import { describe, it, expect } from "vitest";
import { computeStreak } from "../../shared/pulse.ts";

describe("pulse.streak computeStreak", () => {
  const now = new Date(2026, 8, 17, 14, 30); // 2026-09-17 14:30 local time
  // today = 2026-09-17, yesterday = 2026-09-16

  it("returns 0 and null for empty interactions", () => {
    const res = computeStreak([], now);
    expect(res).toEqual({ current: 0, best: 0, lastDay: null });
  });

  it("counts consecutive days ending today as current", () => {
    const interactions = [
      { date: "2026-09-15T10:00:00Z", type: "note" },
      { date: "2026-09-16T12:00:00Z", type: "call" },
      { date: "2026-09-17T09:00:00Z", type: "meeting" },
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 3, best: 3, lastDay: "2026-09-17" });
  });

  it("treats consecutive days ending yesterday as still current", () => {
    const interactions = [
      { date: "2026-09-14T10:00:00Z", type: "note" },
      { date: "2026-09-15T10:00:00Z", type: "note" },
      { date: "2026-09-16T12:00:00Z", type: "call" },
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 3, best: 3, lastDay: "2026-09-16" });
  });

  it("resets current streak when there is a gap before yesterday", () => {
    const interactions = [
      { date: "2026-09-13T10:00:00Z", type: "note" },
      { date: "2026-09-14T10:00:00Z", type: "note" },
      { date: "2026-09-15T12:00:00Z", type: "call" },
      // 2026-09-16 (yesterday) is missing
      // 2026-09-17 (today) is missing
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 0, best: 3, lastDay: "2026-09-15" });
  });

  it("keeps the best streak across history even if current streak is shorter or 0", () => {
    const interactions = [
      // Past 5-day streak
      { date: "2026-08-01T10:00:00Z", type: "note" },
      { date: "2026-08-02T10:00:00Z", type: "note" },
      { date: "2026-08-03T10:00:00Z", type: "note" },
      { date: "2026-08-04T10:00:00Z", type: "note" },
      { date: "2026-08-05T10:00:00Z", type: "note" },
      // Gap
      // Current 2-day streak ending today
      { date: "2026-09-16T10:00:00Z", type: "note" },
      { date: "2026-09-17T10:00:00Z", type: "note" },
    ];
    const res = computeStreak(interactions, now);
    expect(res).toEqual({ current: 2, best: 5, lastDay: "2026-09-17" });
  });

  it("excludes days with only import rows", () => {
    const interactions = [
      { date: "2026-09-16T10:00:00Z", type: "import" },
      { date: "2026-09-17T10:00:00Z", type: "note" },
    ];
    const res = computeStreak(interactions, now);
    // 2026-09-16 only had import, so only 2026-09-17 counts (streak = 1)
    expect(res).toEqual({ current: 1, best: 1, lastDay: "2026-09-17" });
  });

  it("excludes days where source is non-null", () => {
    const interactions = [
      { date: "2026-09-16T10:00:00Z", type: "note", source: "google_calendar" },
      { date: "2026-09-17T10:00:00Z", type: "note", source: null },
    ];
    const res = computeStreak(interactions, now);
    // 2026-09-16 had source set, so only 2026-09-17 counts (streak = 1)
    expect(res).toEqual({ current: 1, best: 1, lastDay: "2026-09-17" });
  });

  it("counts a day if it has at least one valid manual row among import/source rows", () => {
    const interactions = [
      { date: "2026-09-16T08:00:00Z", type: "import" },
      { date: "2026-09-16T09:00:00Z", type: "note", source: "imap" },
      { date: "2026-09-16T10:00:00Z", type: "note", source: null }, // valid!
      { date: "2026-09-17T10:00:00Z", type: "call" }, // valid!
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
