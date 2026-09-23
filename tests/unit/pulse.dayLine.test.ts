// =============================================================================
// The masthead's line of facts
// =============================================================================
// `buildDayLine` turns the day's counts into the items of one line. The
// masthead joins them with a middle dot. The function is pure, so the words
// are checked here and the masthead test checks the dots and the buttons.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  buildDayLine,
  type MastheadCounts,
} from "../../src/views/pulse/lib/dayLine";

const counts = (over: Partial<MastheadCounts> = {}): MastheadCounts => ({
  overdue: 0,
  dueToday: 0,
  birthdaysThisWeek: 0,
  queued: 0,
  streak: 0,
  ...over,
});

const texts = (c: MastheadCounts) => buildDayLine(c).map((item) => item.text);

describe("buildDayLine", () => {
  it("says the day is caught up when the whole queue is empty", () => {
    // Not "Nothing due today": the empty queue under the masthead says it.
    expect(texts(counts())).toEqual(["All caught up"]);
  });

  it("says nothing is due today while this week's rows or catch-ups wait", () => {
    // Two catch-ups sit in the queue: the day is not "All caught up".
    expect(texts(counts({ queued: 2 }))).toEqual(["Nothing due today"]);
  });

  it("uses the singular for one of each", () => {
    expect(
      texts(counts({ overdue: 1, dueToday: 1, birthdaysThisWeek: 1 })),
    ).toEqual(["1 overdue", "1 due today", "1 birthday this week"]);
  });

  it("gives each count its own item, with no commas and no period", () => {
    const items = texts(
      counts({ overdue: 2, dueToday: 2, birthdaysThisWeek: 3, streak: 12 }),
    );
    expect(items).toEqual([
      "2 overdue",
      "2 due today",
      "3 birthdays this week",
      "12 days in a row",
    ]);
    // The masthead puts the dots between the items. No item carries a
    // separator or a closing period of its own.
    for (const text of items) expect(text).not.toMatch(/[,.·]|^\s|\s$/);
  });

  it("leaves a zero count out and keeps the order overdue, today, birthdays", () => {
    expect(texts(counts({ dueToday: 4 }))).toEqual(["4 due today"]);
    expect(texts(counts({ overdue: 1, birthdaysThisWeek: 2 }))).toEqual([
      "1 overdue",
      "2 birthdays this week",
    ]);
  });

  it("adds the streak as one more item from two days, and not before", () => {
    expect(texts(counts({ overdue: 1, streak: 0 }))).toEqual(["1 overdue"]);
    expect(texts(counts({ overdue: 1, streak: 1 }))).toEqual(["1 overdue"]);
    expect(texts(counts({ overdue: 1, streak: 2 }))).toEqual([
      "1 overdue",
      "2 days in a row",
    ]);
    expect(texts(counts({ streak: 12 }))).toEqual([
      "All caught up",
      "12 days in a row",
    ]);
    expect(texts(counts({ queued: 3, streak: 12 }))).toEqual([
      "Nothing due today",
      "12 days in a row",
    ]);
  });

  it("marks exactly the counts with a jump target", () => {
    const items = buildDayLine(
      counts({ overdue: 2, dueToday: 1, birthdaysThisWeek: 3, streak: 5 }),
    );
    expect(items).toEqual([
      { text: "2 overdue", target: "overdue" },
      { text: "1 due today", target: "today" },
      { text: "3 birthdays this week", target: "birthdays" },
      { text: "5 days in a row" },
    ]);
    expect(buildDayLine(counts()).every((item) => !item.target)).toBe(true);
  });
});
