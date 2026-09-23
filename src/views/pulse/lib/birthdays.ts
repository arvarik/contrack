/**
 * Client-side birthday helpers for Pulse Intelligence and Up Next cards.
 *
 * Scans slim contacts for upcoming birthdays within a window (default 14 days),
 * leveraging the parser and leap-year rules in src/lib/birthday.ts.
 */
import { getUpcomingBirthdayInfo } from "../../../lib/birthday";

export interface UpcomingBirthday {
  contactId: string;
  name: string;
  avatarUrl: string | null;
  /** The two fields the ring needs beside the score, carried from the row. */
  isTracked: boolean;
  lastContactedAt: string | null;
  relationshipScore: number | null;
  daysUntil: number;
  turningAge: number | null;
  nextDate: Date;
}

export interface ContactWithBirthday {
  id: string;
  name: string;
  birthday?: string | null;
  avatarUrl?: string | null;
  isTracked?: boolean;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
}

/**
 * Find upcoming birthdays within `maxDays` (default 14 days), sorted by nearest first.
 */
export function getUpcomingBirthdays(
  contacts: readonly ContactWithBirthday[],
  now: Date = new Date(),
  maxDays = 14,
): UpcomingBirthday[] {
  const results: UpcomingBirthday[] = [];

  for (const c of contacts) {
    if (!c.birthday) continue;
    const info = getUpcomingBirthdayInfo(c.birthday, now);
    if (!info) continue;
    if (info.daysUntil >= 0 && info.daysUntil <= maxDays) {
      results.push({
        contactId: c.id,
        name: c.name,
        avatarUrl: c.avatarUrl ?? null,
        isTracked: c.isTracked ?? false,
        lastContactedAt: c.lastContactedAt ?? null,
        relationshipScore: c.relationshipScore ?? null,
        daysUntil: info.daysUntil,
        turningAge: info.turningAge,
        nextDate: info.nextDate,
      });
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}
