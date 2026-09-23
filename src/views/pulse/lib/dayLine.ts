/**
 * The masthead's line of facts.
 *
 * The Today strip used to show its numbers as chips, and a chip that says
 * "2 overdue" beside one that says "3 birthdays" is a row of labels a person
 * has to assemble. One line says the same thing and wraps, so nothing
 * scrolls sideways on a phone. The line is a list of facts, not a sentence:
 * the masthead puts a middle dot between two items (`MetaDot`), with no
 * commas and no closing period, the same way a contact's page joins
 * "Sydney · 2:45 AM". One item stands alone, with no dot. The function is
 * pure: the masthead renders the items, and the unit test reads the words.
 *
 * @module views/pulse/lib/dayLine
 */

/** The numbers the masthead speaks about. */
export interface MastheadCounts {
  overdue: number;
  dueToday: number;
  birthdaysThisWeek: number;
  /**
   * Every row in the Up next queue, this week's and the catch-ups too. The
   * line names only three counts, and "All caught up" has to be true of the
   * whole queue.
   */
  queued: number;
  streak: number;
}

/** Where a count on the line jumps to when it is a button. */
export type JumpTarget = "overdue" | "today" | "birthdays";

/**
 * One item on the line. An item with a `target` is a count, and the
 * masthead renders it as a jump button from `sm` up. An item without one is
 * plain text: "Nothing due today", "All caught up" or the streak.
 */
export interface DayLineItem {
  text: string;
  target?: JumpTarget;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The line under the date, as items in reading order.
 *
 * The counts above zero come first, in the order overdue, due today,
 * birthdays this week. With none of the three above zero, the first item is
 * "Nothing due today" while the queue still holds this week's rows or
 * catch-ups, and "All caught up" once it is empty. The empty queue under the
 * masthead reads "Nothing due today", and the masthead does not say it
 * twice. A streak of two days or more is one more item, "12 days in a row".
 * With the masthead's dots between them, the items read for example:
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
