import { describe, it, expect } from "vitest";
import { computeStreak } from "../../../shared/pulse.ts";

describe("pulse.streak computeStreak", () => {
  const now = new Date(2026, 8, 17, 14, 30); // 2026-09-17 14:30 local time
  // today = 2026-09-17, yesterday = 2026-09-16

  // computeStreak counts local days, so each timestamp is a local hour. A
  // fixed UTC hour falls on another day in Honolulu or Kiritimati.
  const local = (month: number, day: number, hour: number) =>
    new Date(2026, month - 1, day, hour).toISOString();

  it.each([
    [
      "has no streak with no interactions",
      [],
      { current: 0, best: 0, lastDay: null },
    ],
    [
      "counts consecutive days ending today as current",
      [
        { date: local(9, 15, 10), type: "note" },
        { date: local(9, 16, 12), type: "call" },
        { date: local(9, 17, 9), type: "meeting" },
      ],
      { current: 3, best: 3, lastDay: "2026-09-17" },
    ],
    [
      "treats consecutive days ending yesterday as still current",
      [
        { date: local(9, 14, 10), type: "note" },
        { date: local(9, 15, 10), type: "note" },
        { date: local(9, 16, 12), type: "call" },
      ],
      { current: 3, best: 3, lastDay: "2026-09-16" },
    ],
    [
      // Yesterday and today are missing. The best streak stays.
      "resets the current streak after a gap and keeps the best",
      [
        { date: local(8, 1, 10), type: "note" },
        { date: local(8, 2, 10), type: "note" },
        { date: local(8, 3, 10), type: "note" },
        { date: local(9, 15, 12), type: "call" },
      ],
      { current: 0, best: 3, lastDay: "2026-09-15" },
    ],
    [
      // 09-16 has only an import and a synced note, so only 09-17 counts.
      "counts neither imports nor synced rows",
      [
        { date: local(9, 16, 8), type: "import" },
        { date: local(9, 16, 9), type: "note", source: "imap" },
        { date: local(9, 17, 10), type: "note", source: null },
      ],
      { current: 1, best: 1, lastDay: "2026-09-17" },
    ],
  ])("%s", (_what, interactions, streak) => {
    expect(computeStreak(interactions, now)).toEqual(streak);
  });

  it("counts the days on the reader's calendar when it has a zone", () => {
    // 03:00 UTC on the 17th is the evening of the 16th in Los Angeles.
    const interactions = [
      { date: "2026-09-16T18:00:00.000Z", type: "note" },
      { date: "2026-09-17T03:00:00.000Z", type: "note" },
    ];
    const at = new Date("2026-09-17T05:00:00.000Z");
    expect(computeStreak(interactions, at, "America/Los_Angeles")).toEqual({
      current: 1,
      best: 1,
      lastDay: "2026-09-16",
    });
    expect(computeStreak(interactions, at, "UTC")).toEqual({
      current: 2,
      best: 2,
      lastDay: "2026-09-17",
    });
  });
});
