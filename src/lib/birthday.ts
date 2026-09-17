import { formatDay } from "./datetime";

export interface ParsedBirthday {
  year: number | null;
  month: number; // 1-12
  day: number; // 1-31
}

export interface UpcomingBirthdayInfo {
  daysUntil: number;
  turningAge: number | null;
  nextDate: Date;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isValidDay(month: number, day: number, year: number | null): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const maxDays = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > maxDays[month]) return false;
  if (month === 2 && day === 29 && year !== null) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (!isLeap) return false;
  }
  return true;
}

/**
 * Parse a birthday string into structured year/month/day.
 *
 * Supported formats:
 * - "1990-05-14", "1990/05/14"
 * - "05-14", "05/14"
 * - "May 14", "May 14, 1990", "14 May", "14 May 1990", "May 14th"
 * - Unparseable returns null.
 */
export function parseBirthday(
  raw: string | null | undefined,
): ParsedBirthday | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const y = Number(ymdMatch[1]);
    const m = Number(ymdMatch[2]);
    const d = Number(ymdMatch[3]);
    if (isValidDay(m, d, y)) return { year: y, month: m, day: d };
    return null;
  }

  // 2. MM-DD or MM/DD (without year)
  const mdMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (mdMatch) {
    const m = Number(mdMatch[1]);
    const d = Number(mdMatch[2]);
    if (isValidDay(m, d, null)) return { year: null, month: m, day: d };
    return null;
  }

  // 3. Named month formats: "May 14", "May 14, 1990", "May 14th 1990"
  const namedMonthFirst = trimmed.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/,
  );
  if (namedMonthFirst) {
    const monthKey = namedMonthFirst[1].toLowerCase();
    const month = MONTH_NAMES[monthKey];
    if (month) {
      const d = Number(namedMonthFirst[2]);
      const y = namedMonthFirst[3] ? Number(namedMonthFirst[3]) : null;
      if (isValidDay(month, d, y)) return { year: y, month, day: d };
    }
  }

  // 4. "14 May", "14 May 1990", "14th May 1990"
  const dayMonthFirst = trimmed.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:,?\s+(\d{4}))?$/,
  );
  if (dayMonthFirst) {
    const monthKey = dayMonthFirst[2].toLowerCase();
    const month = MONTH_NAMES[monthKey];
    if (month) {
      const d = Number(dayMonthFirst[1]);
      const y = dayMonthFirst[3] ? Number(dayMonthFirst[3]) : null;
      if (isValidDay(month, d, y)) return { year: y, month, day: d };
    }
  }

  // 5. Try new Date parse if standard
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      // Check if raw contained a 4-digit year
      const yearMatch = trimmed.match(/\b(\d{4})\b/);
      const hasYear = !!yearMatch;
      const y = hasYear ? d.getFullYear() : null;
      const m = d.getMonth() + 1;
      const day = d.getDate();
      if (isValidDay(m, day, y)) return { year: y, month: m, day };
    }
  } catch {}

  return null;
}

/**
 * Normalize value to YYYY-MM-DD for <input type="date">.
 * Preserves BirthdayField.tsx's original behavior.
 */
export function toBirthdayInputValue(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const parsed = parseBirthday(v);
  if (parsed && parsed.year !== null) {
    return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  }
  // Try fallback date parsing
  try {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return "";
}

/**
 * Format a birthday for display.
 * Reads a YYYY-MM-DD via formatDay; if unparseable to input, shows stored string.
 */
export function formatBirthdayDisplay(
  v: string | null | undefined,
): string | null {
  if (!v) return null;
  const inputVal = toBirthdayInputValue(v);
  if (!inputVal) return v;
  return formatDay(inputVal, v);
}

/**
 * Calculate the next birthday, days until it, and turning age if year is known.
 *
 * Special rules:
 * - 29 February on a non-leap year is treated as 1 March.
 * - "turning N" is only returned when a year is known.
 */
export function getUpcomingBirthdayInfo(
  raw: string | null | undefined,
  now: Date = new Date(),
): UpcomingBirthdayInfo | null {
  const parsed = parseBirthday(raw);
  if (!parsed) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisYear = today.getFullYear();

  // Helper to build birthday Date for a given calendar year
  const makeBirthdayDate = (year: number): Date => {
    if (parsed.month === 2 && parsed.day === 29) {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      if (!isLeap) {
        // Non-leap year: 29 February treated as 1 March
        return new Date(year, 2, 1);
      }
    }
    return new Date(year, parsed.month - 1, parsed.day);
  };

  let bday = makeBirthdayDate(thisYear);
  let bdayYear = thisYear;

  // If already passed this year, take next year's birthday
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

/**
 * Returns days until upcoming birthday if within maxDays (default 30), or null.
 * Used by BirthdayField badge.
 */
export function getUpcomingBirthdayDays(
  raw: string | null | undefined,
  now: Date = new Date(),
  maxDays = 30,
): number | null {
  const info = getUpcomingBirthdayInfo(raw, now);
  if (!info) return null;
  return info.daysUntil <= maxDays ? info.daysUntil : null;
}
