/**
 * Birthdays on the contact page and Pulse. The parser is shared with the
 * server's vCard export (`shared/birthday`).
 *
 * @module lib/birthday
 */
import { parseBirthday } from "../../shared/birthday";

interface UpcomingBirthdayInfo {
  daysUntil: number;
  turningAge: number | null;
  nextDate: Date;
}

/** The day as a Date. 2000 is a leap year, so 29 February is a day in it. */
function dayOf(parsed: { year: number | null; month: number; day: number }) {
  const date = new Date(2000, parsed.month - 1, parsed.day);
  if (parsed.year !== null) date.setFullYear(parsed.year);
  return date;
}

/**
 * Format a birthday for display: "May 14, 1990", or "May 14" with no year.
 * Text that is no date shows as it was stored.
 */
export function formatBirthdayDisplay(
  v: string | null | undefined,
): string | null {
  if (!v) return null;
  const parsed = parseBirthday(v);
  if (!parsed) return v;
  return dayOf(parsed).toLocaleDateString(
    undefined,
    parsed.year === null
      ? { month: "short", day: "numeric" }
      : { dateStyle: "medium" },
  );
}

/**
 * A birthday as the editor shows it: "May 14, 1990", or "May 14". English
 * month names whatever the locale, because the parser reads them back.
 */
export function birthdayText(v: string | null | undefined): string {
  const parsed = parseBirthday(v);
  if (!parsed) return v ?? "";
  const monthDay = dayOf(parsed).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  return parsed.year === null ? monthDay : `${monthDay}, ${parsed.year}`;
}

/**
 * The next birthday, the days until it, and the age it turns when the year
 * is known. 29 February is 1 March in a year that is not a leap year.
 */
export function getUpcomingBirthdayInfo(
  raw: string | null | undefined,
  now: Date = new Date(),
): UpcomingBirthdayInfo | null {
  const parsed = parseBirthday(raw);
  if (!parsed) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisYear = today.getFullYear();

  const makeBirthdayDate = (year: number): Date => {
    if (parsed.month === 2 && parsed.day === 29) {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      if (!isLeap) {
        return new Date(year, 2, 1);
      }
    }
    return new Date(year, parsed.month - 1, parsed.day);
  };

  let bday = makeBirthdayDate(thisYear);
  let bdayYear = thisYear;

  if (bday < today) {
    bdayYear = thisYear + 1;
    bday = makeBirthdayDate(bdayYear);
  }

  const diffMs = bday.getTime() - today.getTime();
  const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const turningAge = parsed.year !== null ? bdayYear - parsed.year : null;

  return {
    daysUntil,
    turningAge,
    nextDate: bday,
  };
}

/** How many days ahead the birthday badge looks. */
const BADGE_WINDOW_DAYS = 30;

/** The days until the birthday when it is within the badge window, or null. */
export function getUpcomingBirthdayDays(
  raw: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const info = getUpcomingBirthdayInfo(raw, now);
  if (!info) return null;
  return info.daysUntil <= BADGE_WINDOW_DAYS ? info.daysUntil : null;
}
