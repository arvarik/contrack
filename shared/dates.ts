/**
 * Shared Date Utilities.
 *
 * Days and weeks are calculated in local server time.
 */

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
