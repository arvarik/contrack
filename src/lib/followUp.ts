/**
 * The next follow-up as a fact: "Follow-up 3 days overdue", "Follow-up due
 * Friday". The contact page's banner and a Network row say it, in the words
 * and tones of Pulse's due chip, so a follow-up reads the same everywhere.
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

interface FollowUpDue {
  /** Calendar days from today to the due day. Negative once it is past. */
  days: number;
  /** The sentence, in sentence case. */
  text: string;
  tone: Tone;
}

/**
 * Describe `nextFollowUpAt` against `now`, or null when it is no date.
 * Counted in calendar days, so a follow-up due at 9 AM is "due today" all
 * day. A date with no time is that day on the reader's calendar.
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
