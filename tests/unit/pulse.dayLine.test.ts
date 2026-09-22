// =============================================================================
// The masthead's sentence and the words on its progress mark
// =============================================================================
// `buildDayLine` turns the day's counts into the parts of one sentence, and
// `describeProgress` into the words beside the ring. Both are pure, so the
// words are checked here and the masthead test checks only that they render.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  buildDayLine,
  describeProgress,
  type MastheadCounts,
} from "../../src/views/pulse/lib/dayLine";

const counts = (over: Partial<MastheadCounts> = {}): MastheadCounts => ({
  overdue: 0,
  dueToday: 0,
  birthdaysThisWeek: 0,
  completedToday: 0,
  streak: 0,
  ...over,
});

const joined = (c: MastheadCounts) =>
  buildDayLine(c)
    .map((part) => part.text)
    .join("");

describe("buildDayLine", () => {
  it("says nothing is due when every count is zero", () => {
    expect(joined(counts())).toBe("Nothing due today.");
  });

  it("uses the singular for one of each", () => {
    expect(
      joined(counts({ overdue: 1, dueToday: 1, birthdaysThisWeek: 1 })),
    ).toBe("1 overdue, 1 due today, 1 birthday this week.");
  });

  it("joins three counts with two commas and closes with a period", () => {
    expect(
      joined(counts({ overdue: 2, dueToday: 2, birthdaysThisWeek: 3 })),
    ).toBe("2 overdue, 2 due today, 3 birthdays this week.");
  });

  it("leaves a zero count out and keeps the order overdue, today, birthdays", () => {
    expect(joined(counts({ dueToday: 4 }))).toBe("4 due today.");
    expect(joined(counts({ overdue: 1, birthdaysThisWeek: 2 }))).toBe(
      "1 overdue, 2 birthdays this week.",
    );
  });

  it("adds the streak from two days, and not before", () => {
    expect(joined(counts({ overdue: 1, streak: 0 }))).toBe("1 overdue.");
    expect(joined(counts({ overdue: 1, streak: 1 }))).toBe("1 overdue.");
    expect(joined(counts({ overdue: 1, streak: 2 }))).toBe(
      "1 overdue. 2 days in a row.",
    );
    expect(joined(counts({ streak: 12 }))).toBe(
      "Nothing due today. 12 days in a row.",
    );
  });

  it("marks exactly the counts with a jump target", () => {
    const parts = buildDayLine(
      counts({ overdue: 2, dueToday: 1, birthdaysThisWeek: 3, streak: 5 }),
    );
    const targets = parts
      .filter((part) => part.target)
      .map((part) => [part.text, part.target]);
    expect(targets).toEqual([
      ["2 overdue", "overdue"],
      ["1 due today", "today"],
      ["3 birthdays this week", "birthdays"],
    ]);
    // The separators, the period and the streak are plain text.
    expect(
      parts.filter((part) => !part.target).map((part) => part.text),
    ).toEqual([", ", ", ", ".", " 5 days in a row."]);
    expect(buildDayLine(counts()).every((part) => !part.target)).toBe(true);
  });
});

describe("describeProgress", () => {
  it("follows the state of the day", () => {
    expect(describeProgress(0, 0)).toBe("Nothing due");
    expect(describeProgress(0, 4)).toBe("4 to do");
    expect(describeProgress(2, 0)).toBe("All done");
    expect(describeProgress(1, 3)).toBe("1 of 4 done");
  });
});
