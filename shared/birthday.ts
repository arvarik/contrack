/**
 * Birthdays as people and address books write them, read one way by the
 * contact page, Pulse and the vCard writer. A day with no year is common:
 * Apple writes it as the year 1604, vCard 4 as "--0514". Neither is a real
 * year.
 */

/** The year Apple's address books write for a birthday with no year. */
const OMIT_YEAR = 1604;

export interface ParsedBirthday {
  year: number | null;
  month: number; // 1-12
  day: number; // 1-31
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
 * Parses a birthday into year, month and day, or null:
 * - "1990-05-14", "1990/05/14", "19900514"
 * - "05-14", "05/14", "--0514", "--05-14", and Apple's "1604-05-14"
 * - "May 14", "May 14, 1990", "14 May", "14 May 1990", "May 14th"
 */
export function parseBirthday(
  raw: string | null | undefined,
): ParsedBirthday | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. YYYY-MM-DD, YYYY/MM/DD or vCard's YYYYMMDD. Apple's address books
  //    write a birthday with no year in the year 1604.
  const ymdMatch =
    trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/) ??
    trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymdMatch) {
    const y = Number(ymdMatch[1]) === OMIT_YEAR ? null : Number(ymdMatch[1]);
    const m = Number(ymdMatch[2]);
    const d = Number(ymdMatch[3]);
    if (isValidDay(m, d, y)) return { year: y, month: m, day: d };
    return null;
  }

  // 2. MM-DD or MM/DD, and vCard 4's --MMDD or --MM-DD (without year)
  const mdMatch =
    trimmed.match(/^(\d{1,2})[-/](\d{1,2})$/) ??
    trimmed.match(/^--(\d{2})-?(\d{2})$/);

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

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The form a birthday is stored in: "1990-05-14", or "05-14" with no year.
 * A year-less day stays year-less.
 */
export function birthdayValue({ year, month, day }: ParsedBirthday): string {
  const monthDay = `${pad(month)}-${pad(day)}`;
  return year === null
    ? monthDay
    : `${String(year).padStart(4, "0")}-${monthDay}`;
}

/**
 * The BDAY line of a vCard: "BDAY:1990-05-14". vCard 3.0 has no date
 * without a year, and iCloud drops one, so a birthday with no year takes
 * Apple's own form: the year 1604, which the parameter says to leave out.
 * Null for text that is no date.
 */
export function vcardBirthdayLine(birthday: string): string | null {
  const parsed = parseBirthday(birthday);
  if (!parsed) return null;
  return parsed.year === null
    ? `BDAY;X-APPLE-OMIT-YEAR=${OMIT_YEAR}:${birthdayValue({ ...parsed, year: OMIT_YEAR })}`
    : `BDAY:${birthdayValue(parsed)}`;
}
