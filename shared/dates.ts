/**
 * Shared Date Utilities.
 *
 * Days and weeks are calculated in local server time.
 */

/**
 * Parse a timestamp from the API, whichever of its forms it is in.
 *
 * SQLite's `CURRENT_TIMESTAMP` writes `2026-09-10 05:33:50`: UTC, with a
 * space and no zone marker. JavaScript writes `2026-09-10T05:33:50.000Z`.
 * Both land in the same columns, and `new Date()` reads the first as local
 * time, which puts it hours out. A date with no time (`2026-09-23`, a
 * birthday or a follow-up's day) is a day on the calendar, not an instant,
 * so it is read as local midnight: as UTC midnight it is the day before
 * anywhere west of Greenwich.
 *
 * Returns null rather than an Invalid Date, so a caller decides what to show.
 */
export function parseServerTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // A space separator and no zone means SQLite wrote it, and SQLite writes
  // UTC. Naming the zone is what stops the runtime assuming local.
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole days on the local calendar from `from` to `to`: 0 on the same day,
 * 1 the next day, -1 the day before. The time of day does not count, and a
 * change to or from daylight saving time does not either.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  const day = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/**
 * True when a follow-up's day is before today on the local calendar.
 *
 * A follow-up due today is not late until midnight. The contact page's
 * banner counts the same way, so the map, its stats and the banner agree.
 */
export function isPastDay(
  value: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const due = parseServerTime(value);
  return due !== null && calendarDaysBetween(now, due) < 0;
}

export type WeekStartPref = "monday" | "sunday";

/**
 * Returns 0 for Sunday, 1 for Monday.
 */
export function weekStartsOn(pref: WeekStartPref = "monday"): 0 | 1 {
  return pref === "sunday" ? 0 : 1;
}

/**
 * Returns the ISO Monday date string (YYYY-MM-DD) for a given date.
 *
 * In ISO 8601, the week starts on Monday.
 * Sunday belongs to the preceding Monday.
 * Monday is itself.
 */
export function isoWeekStart(date: Date | string | number): string {
  let localDate: Date;
  if (typeof date === "string") {
    // If YYYY-MM-DD, parse as local calendar day to avoid UTC midnight shifts
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      localDate = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
      );
    } else {
      const d = new Date(date);
      localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  } else if (date instanceof Date) {
    localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  } else {
    const d = new Date(date);
    localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  const day = localDate.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const diff = day === 0 ? 6 : day - 1;
  localDate.setDate(localDate.getDate() - diff);

  const yyyy = localDate.getFullYear();
  const mm = String(localDate.getMonth() + 1).padStart(2, "0");
  const dd = String(localDate.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
