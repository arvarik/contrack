/**
 * The masthead's sentence and the words on its progress mark.
 *
 * The Today strip used to show its numbers as chips, and a chip that says
 * "2 overdue" beside one that says "3 birthdays" is a row of labels a person
 * has to assemble. One sentence says the same thing and wraps, so nothing
 * scrolls sideways on a phone. Both functions are pure: the masthead renders
 * the parts, and the unit test reads the words.
 *
 * @module views/pulse/lib/dayLine
 */

/** The numbers the masthead speaks about. */
export interface MastheadCounts {
  overdue: number;
  dueToday: number;
  birthdaysThisWeek: number;
  completedToday: number;
  streak: number;
}

/** Where a count in the sentence jumps to when it is a button. */
export type JumpTarget = "overdue" | "today" | "birthdays";

/**
 * One piece of the sentence. A part with a `target` is a count, and the
 * masthead renders it as a jump button from `sm` up. A part without one is
 * plain text: a separator, the closing period, or the streak.
 */
export interface DayLinePart {
  text: string;
  target?: JumpTarget;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The sentence under the date, as parts.
 *
 * The counts above zero come first, in the order overdue, due today,
 * birthdays this week, joined by ", " and closed by ".". With no count above
 * zero the first part is "Nothing due today." A streak of two days or more
 * adds " 12 days in a row." Joined, the parts read for example:
 *
 *   "2 overdue, 2 due today, 3 birthdays this week. 12 days in a row."
 *   "1 overdue, 1 due today, 1 birthday this week."
 *   "Nothing due today."
 */
export function buildDayLine(c: MastheadCounts): DayLinePart[] {
  const counts: DayLinePart[] = [];
  if (c.overdue > 0) {
    counts.push({ text: `${c.overdue} overdue`, target: "overdue" });
  }
  if (c.dueToday > 0) {
    counts.push({ text: `${c.dueToday} due today`, target: "today" });
  }
  if (c.birthdaysThisWeek > 0) {
    counts.push({
      text: plural(
        c.birthdaysThisWeek,
        "birthday this week",
        "birthdays this week",
      ),
      target: "birthdays",
    });
  }

  const parts: DayLinePart[] = [];
  if (counts.length === 0) {
    parts.push({ text: "Nothing due today." });
  } else {
    counts.forEach((part, index) => {
      if (index > 0) parts.push({ text: ", " });
      parts.push(part);
    });
    parts.push({ text: "." });
  }

  if (c.streak >= 2) {
    parts.push({ text: ` ${c.streak} days in a row.` });
  }
  return parts;
}

/**
 * The words beside the progress mark. `toDo` is overdue plus due today.
 *
 *   (0, 0) "Nothing due"   (0, 4) "4 to do"
 *   (2, 0) "All done"      (1, 3) "1 of 4 done"
 */
export function describeProgress(completed: number, toDo: number): string {
  const total = completed + toDo;
  if (total === 0) return "Nothing due";
  if (completed === 0) return `${toDo} to do`;
  if (toDo === 0) return "All done";
  return `${completed} of ${total} done`;
}
