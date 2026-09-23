/**
 * The next follow-up, said as a fact (`src/lib/followUp.ts`).
 *
 * The contact page's banner and a Network row read it. Its words are
 * Pulse's due chip and its tones Pulse's `DUE_TONE`, so a follow-up reads
 * the same in all three places. The days are calendar days, from a fixed
 * `now` built on the local calendar, so the test holds in any time zone.
 */
import { describe, expect, it } from "vitest";
import { BANNER_DAYS, describeFollowUp } from "../../src/lib/followUp";
import { getPresetDate } from "../../src/views/map/FollowUpModal";

/** Tuesday, September 22, 2026, at noon on the local calendar. */
const NOON = new Date(2026, 8, 22, 12, 0);
/** A second before midnight on the same day. */
const LATE = new Date(2026, 8, 22, 23, 59, 59);

const weekday = (day: number) =>
  new Date(2026, 8, day).toLocaleDateString(undefined, { weekday: "long" });

describe("describeFollowUp", () => {
  it("reads a date with no time, as the follow-up dialog writes it, as that day", () => {
    const tomorrow = getPresetDate("tomorrow", NOON);
    expect(tomorrow).toBe("2026-09-23");
    expect(describeFollowUp(tomorrow, NOON)).toEqual({
      days: 1,
      tone: "neutral",
      text: "Follow-up due tomorrow",
    });
    // Late in the evening it is still tomorrow's, not late: read as UTC
    // midnight it was already past anywhere west of Greenwich.
    expect(describeFollowUp(tomorrow, LATE)?.days).toBe(1);
    const nextWeek = getPresetDate("nextweek", NOON);
    expect(describeFollowUp(nextWeek, NOON)?.days).toBe(7);
  });

  it("says due today all day, in the primary tone", () => {
    for (const now of [NOON, LATE]) {
      expect(describeFollowUp("2026-09-22", now)).toEqual({
        days: 0,
        tone: "primary",
        text: "Follow-up due today",
      });
    }
    // An instant at 9 AM today is due today at noon, not overdue.
    const nineToday = new Date(2026, 8, 22, 9, 0).toISOString();
    expect(describeFollowUp(nineToday, NOON)?.text).toBe("Follow-up due today");
  });

  it("counts the days a past follow-up is late, in the error tone", () => {
    expect(describeFollowUp("2026-09-19", NOON)).toEqual({
      days: -3,
      tone: "error",
      text: "Follow-up 3 days overdue",
    });
    const yesterday = new Date(2026, 8, 21, 23, 0).toISOString();
    expect(describeFollowUp(yesterday, NOON)?.text).toBe(
      "Follow-up 1 day overdue",
    );
  });

  it("names the weekday inside the week, and keeps its capital", () => {
    expect(describeFollowUp("2026-09-25", NOON)).toEqual({
      days: 3,
      tone: "neutral",
      text: `Follow-up due ${weekday(25)}`,
    });
  });

  it("counts the days from a week out, as Pulse's chip does", () => {
    expect(describeFollowUp("2026-09-29", NOON)).toEqual({
      days: 7,
      tone: "neutral",
      text: "Follow-up due in 7 days",
    });
    expect(describeFollowUp("2026-09-30", NOON)?.text).toBe(
      "Follow-up due in 8 days",
    );
    expect(describeFollowUp("2026-11-06", NOON)?.days).toBe(45);
  });

  it("shows the banner for the whole week Pulse's This week holds", () => {
    expect(BANNER_DAYS).toBe(7);
    expect(describeFollowUp("2026-09-29", NOON)!.days).toBeLessThanOrEqual(
      BANNER_DAYS,
    );
    expect(describeFollowUp("2026-09-30", NOON)!.days).toBeGreaterThan(
      BANNER_DAYS,
    );
  });

  it("says nothing for a missing or unreadable value", () => {
    expect(describeFollowUp(null, NOON)).toBeNull();
    expect(describeFollowUp(undefined, NOON)).toBeNull();
    expect(describeFollowUp("", NOON)).toBeNull();
    expect(describeFollowUp("not a date", NOON)).toBeNull();
  });
});
