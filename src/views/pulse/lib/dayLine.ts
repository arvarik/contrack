/**
 * The masthead's line of facts: a list joined by middle dots, not a
 * sentence, so it has no commas and no closing period.
 */
import { plural } from "../../../lib/utils";

export interface MastheadCounts {
  overdue: number;
  dueToday: number;
  birthdaysThisWeek: number;
  /** Every row in the queue, so "All caught up" is true of all of it. */
  queued: number;
  streak: number;
}

/** Where a count on the line jumps to when it is a button. */
export type JumpTarget = "overdue" | "today" | "birthdays";

/** An item with a `target` is a count, a jump button from `sm` up. */
interface DayLineItem {
  text: string;
  target?: JumpTarget;
}

/**
 * The line's items in reading order. With no count above zero, the first
 * item is "Nothing due today" while the queue holds rows, and "All caught up"
 * once it is empty, because the empty queue already says "Nothing due today".
 * For example:
 *
 *   "2 overdue · 2 due today · 3 birthdays this week · 12 days in a row"
 *   "1 overdue · 1 due today · 1 birthday this week"
 *   "Nothing due today · 12 days in a row"
 *   "All caught up"
 */
export function buildDayLine(c: MastheadCounts): DayLineItem[] {
  const items: DayLineItem[] = [];
  if (c.overdue > 0) {
    items.push({ text: `${c.overdue} overdue`, target: "overdue" });
  }
  if (c.dueToday > 0) {
    items.push({ text: `${c.dueToday} due today`, target: "today" });
  }
  if (c.birthdaysThisWeek > 0) {
    items.push({
      text: plural(
        c.birthdaysThisWeek,
        "birthday this week",
        "birthdays this week",
      ),
      target: "birthdays",
    });
  }
  if (items.length === 0) {
    items.push({
      text: c.queued > 0 ? "Nothing due today" : "All caught up",
    });
  }
  if (c.streak >= 2) {
    items.push({ text: `${c.streak} days in a row` });
  }
  return items;
}
