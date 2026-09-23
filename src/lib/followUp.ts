/**
 * The next follow-up, said as a fact: how late it is, or when it is due.
 *
 * "Follow-up 3 days overdue", "Follow-up due today", "Follow-up due Friday",
 * "Follow-up due in 9 days". The contact page's banner says it, and a
 * Network row carries it in its name and in the calendar glyph's tooltip.
 * The words are Pulse's due chip (`describeDueChip`) and the tones are its
 * `DUE_TONE`, so a follow-up reads the same on Pulse, on the contact and in
 * the list. The days are counted by `calendarDaysBetween`, which the map's
 * overdue count uses too.
 *
 * @module lib/followUp
 */
import { calendarDaysBetween } from "../../shared/dates";
import { describeDueChip } from "../views/pulse/lib/upNext";
import { DUE_TONE } from "../views/pulse/lib/pulseStyles";
import { parseServerTime } from "./datetime";
import type { Tone } from "./styles";

/**
 * The last day the contact page's banner shows a follow-up for: a week out,
 * the same days Pulse's "This week" group holds.
 */
export const BANNER_DAYS = 7;

export interface FollowUpDue {
  /** Calendar days from today to the due day. Negative once it is past. */
  days: number;
  /** The sentence, in sentence case. */
  text: string;
  tone: Tone;
}

/**
 * Describe `nextFollowUpAt` against `now`. Null when there is no follow-up,
 * or when the value is not a date.
 *
 * Counted in calendar days, so a follow-up due at 9 AM is "due today" all
 * day and "1 day overdue" from midnight. A date with no time, which is what
 * the follow-up dialog writes, is that day on the reader's calendar.
 */
export function describeFollowUp(
  value: string | null | undefined,
  now: Date = new Date(),
): FollowUpDue | null {
  const due = parseServerTime(value);
  if (!due) return null;
  const days = calendarDaysBetween(now, due);
  const chip = describeDueChip(days, due);
  if (days < 0) {
    return { days, tone: DUE_TONE.urgent, text: `Follow-up ${chip}` };
  }
  // The chip starts a sentence ("Today", "In 9 days") and here it ends one.
  // A weekday keeps its capital.
  const weekday = due.toLocaleDateString(undefined, { weekday: "long" });
  const when =
    chip === weekday ? chip : chip.charAt(0).toLowerCase() + chip.slice(1);
  return {
    days,
    tone: days === 0 ? DUE_TONE.today : DUE_TONE.upcoming,
    text: `Follow-up due ${when}`,
  };
}
