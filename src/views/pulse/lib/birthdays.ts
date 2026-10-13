/** Upcoming birthdays and contact dates for the Pulse cards, by `lib/birthday.ts` rules. */
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
  /** The date's label ("Birthday", "Anniversary", or a custom type). */
  label?: string;
}

interface ContactWithBirthday {
  id: string;
  name: string;
  birthday?: string | null;
  attributes?: readonly { name: string; value: string }[];
  avatarUrl?: string | null;
  isTracked?: boolean;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
}

function capitalizeLabel(raw: string): string {
  const trimmed = raw.trim() || "Other";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Birthdays and custom contact dates within `maxDays`, nearest first. */
export function getUpcomingBirthdays(
  contacts: readonly ContactWithBirthday[],
  now: Date = new Date(),
  maxDays = 14,
): UpcomingBirthday[] {
  const results: UpcomingBirthday[] = [];

  const pushDate = (
    c: ContactWithBirthday,
    dateStr: string | null | undefined,
    label: string,
  ) => {
    if (!dateStr) return;
    const info = getUpcomingBirthdayInfo(dateStr, now);
    if (!info) return;
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
        label,
      });
    }
  };

  for (const c of contacts) {
    pushDate(c, c.birthday, "Birthday");
    for (const attr of c.attributes ?? []) {
      if (!attr.name.startsWith("date:")) continue;
      pushDate(c, attr.value, capitalizeLabel(attr.name.slice(5)));
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}
