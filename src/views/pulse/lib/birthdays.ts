/** Upcoming birthdays for the Pulse cards, by `lib/birthday.ts` rules. */
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

interface ContactWithBirthday {
  id: string;
  name: string;
  birthday?: string | null;
  avatarUrl?: string | null;
  isTracked?: boolean;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
}

/** Birthdays within `maxDays`, nearest first. */
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
