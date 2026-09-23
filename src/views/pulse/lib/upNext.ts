/**
 * Up Next Queue Ranking and Grouping.
 *
 * Ranks all pending actionable items in order:
 * 1. Overdue (oldest dueAt first)
 * 2. Due today
 * 3. This week (upcoming follow-ups within 7 days)
 * 4. Birthdays this week (pseudo-items)
 * 5. Catch up: tracked contacts past their cadence, the furthest first
 *
 * A catch-up ranks after a birthday. It is a soft reminder, and a due
 * follow-up is a promise with a date. The server sends ten at most and the
 * group takes every one; the heading says "10 of 14" when there are more.
 */
import { differenceInCalendarDays } from "date-fns";
import type { ActionItem } from "../../../types";
import type { CatchUpCard } from "../../../../shared/pulse";
import { describePastDue } from "../../../../shared/pastDue";
import { parseServerTime } from "../../../lib/datetime";
import type { UpcomingBirthday } from "./birthdays";

export type UpNextGroup =
  "overdue" | "today" | "thisWeek" | "birthdays" | "catch-up";

export type UpNextItemKind = "action_item" | "birthday" | "catch-up";

/**
 * What a row's ring needs, for a contact the row itself does not carry.
 *
 * An action item names a contact and holds no score, so the ring used to
 * draw an empty track for every one of them. The queue takes a lookup from
 * the slim contact cache, which the Pulse page already holds, and a row
 * whose contact is missing from it shows the picture alone.
 */
export interface UpNextContactScore {
  isTracked: boolean;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
}

export interface UpNextItem {
  id: string;
  kind: UpNextItemKind;
  group: UpNextGroup;
  contactId: string;
  contactName: string;
  contactAvatarUrl: string | null;
  /** A person tracks this contact, so its ring means something. */
  isTracked: boolean;
  relationshipScore: number | null;
  lastContactedAt: string | null;
  title: string;
  hasCheckAction: boolean;
  dueChip: {
    text: string;
    variant: "urgent" | "today" | "upcoming" | "neutral";
  };
}

export interface UpNextGroupMeta {
  group: UpNextGroup;
  label: string;
  items: UpNextItem[];
  count: number;
  /**
   * How many there are in all, when more than the rows shown. The Catch up
   * group carries the server's ten rows and the count past them, so the
   * heading can read "10 of 14".
   */
  of?: number;
}

export interface UpNextResult {
  items: UpNextItem[];
  groups: UpNextGroupMeta[];
  counts: {
    overdue: number;
    today: number;
    thisWeek: number;
    birthdays: number;
    catchUp: number;
    total: number;
  };
}

export interface BuildUpNextOptions {
  overdue?: ActionItem[];
  dueToday?: ActionItem[];
  upcoming?: ActionItem[];
  birthdays?: UpcomingBirthday[];
  /** The server's Catch up list, ten at most, the furthest past due first. */
  catchUp?: CatchUpCard[];
  /** How many catch-ups there are in all, past the ten. */
  catchUpCount?: number;
  /** The score fields for every contact, by contact id. See the type above. */
  contactScores?: ReadonlyMap<string, UpNextContactScore>;
  now?: Date;
}

/** The group headings, in sentence case. */
export const GROUP_LABELS: Record<UpNextGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  birthdays: "Birthdays",
  "catch-up": "Catch up",
};

/**
 * The words on a due chip, in sentence case.
 *
 * `daysFromNow` is the calendar-day distance to the due date: negative for
 * a past date. A past date counts its days, "1 day overdue" and "12 days
 * overdue": the row sits under the Overdue heading, so a bare "Overdue"
 * repeated the heading and hid how late it was. Today and tomorrow are
 * named. Inside the week the chip says the weekday in full ("Wednesday")
 * when it has the date, and "In 2 days" when it does not. From a week out
 * it counts days. A catch-up row does not come here: its chip is
 * `describePastDue`.
 *
 * The chips used to read "12D OVERDUE", "IN 2D" and "WED", which a person
 * has to decode. A chip is a fact, and a fact reads as words.
 */
export function describeDueChip(
  daysFromNow: number,
  dueDate?: Date | null,
): string {
  const days = Math.round(daysFromNow);
  if (days < 0) {
    const late = -days;
    return `${late} ${late === 1 ? "day" : "days"} overdue`;
  }
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7 && dueDate) {
    return dueDate.toLocaleDateString(undefined, { weekday: "long" });
  }
  return `In ${days} days`;
}

/**
 * Build the ranked Up Next queue.
 */
export function buildUpNextQueue(options: BuildUpNextOptions): UpNextResult {
  const {
    overdue = [],
    dueToday = [],
    upcoming = [],
    birthdays = [],
    catchUp = [],
    catchUpCount,
    contactScores,
    now = new Date(),
  } = options;

  /** The ring fields for a contact, or an untracked stand-in. */
  const ringOf = (contactId: string) => {
    const found = contactScores?.get(contactId);
    return {
      isTracked: found?.isTracked ?? false,
      relationshipScore: found?.relationshipScore ?? null,
      lastContactedAt: found?.lastContactedAt ?? null,
    };
  };

  const overdueItems: UpNextItem[] = [...overdue]
    .sort((a, b) => {
      const timeA = parseServerTime(a.dueAt)?.getTime() ?? 0;
      const timeB = parseServerTime(b.dueAt)?.getTime() ?? 0;
      return timeA - timeB; // Oldest dueAt first
    })
    .map((item) => {
      // The server put it in this bucket, so it is at least a day late
      // whatever the browser's clock says. A date with no time is that day
      // on the local calendar (`parseServerTime`), as the contact page's
      // banner reads it: read as UTC midnight it was a day early west of
      // Greenwich, "4 days overdue" beside the banner's "3 days".
      const due = parseServerTime(item.dueAt);
      const daysLate = due
        ? Math.min(-1, differenceInCalendarDays(due, now))
        : -1;
      return {
        id: item.id,
        kind: "action_item",
        group: "overdue",
        contactId: item.contactId,
        contactName: item.contactName ?? "",
        contactAvatarUrl: item.contactAvatarUrl ?? null,
        ...ringOf(item.contactId),
        title: item.title,
        hasCheckAction: true,
        dueChip: {
          text: describeDueChip(daysLate),
          variant: "urgent",
        },
      };
    });

  const todayItems: UpNextItem[] = dueToday.map((item) => ({
    id: item.id,
    kind: "action_item",
    group: "today",
    contactId: item.contactId,
    contactName: item.contactName ?? "",
    contactAvatarUrl: item.contactAvatarUrl ?? null,
    ...ringOf(item.contactId),
    title: item.title,
    hasCheckAction: true,
    dueChip: {
      text: describeDueChip(0),
      variant: "today",
    },
  }));

  const thisWeekItems: UpNextItem[] = [...upcoming]
    .sort((a, b) => {
      const timeA = parseServerTime(a.dueAt)?.getTime() ?? 0;
      const timeB = parseServerTime(b.dueAt)?.getTime() ?? 0;
      return timeA - timeB;
    })
    .map((item) => {
      // In this bucket the date is after today, so at least a day out.
      const due = parseServerTime(item.dueAt);
      const label = due
        ? describeDueChip(Math.max(1, differenceInCalendarDays(due, now)), due)
        : "Upcoming";
      return {
        id: item.id,
        kind: "action_item",
        group: "thisWeek",
        contactId: item.contactId,
        contactName: item.contactName ?? "",
        contactAvatarUrl: item.contactAvatarUrl ?? null,
        ...ringOf(item.contactId),
        title: item.title,
        hasCheckAction: true,
        dueChip: {
          text: label,
          variant: "upcoming",
        },
      };
    });

  // Filter birthdays to next 7 days for Up Next
  const birthdayItems: UpNextItem[] = birthdays
    .filter((b) => b.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .map((b) => ({
      id: `bday-${b.contactId}`,
      kind: "birthday",
      group: "birthdays",
      contactId: b.contactId,
      contactName: b.name,
      contactAvatarUrl: b.avatarUrl,
      isTracked: b.isTracked,
      relationshipScore: b.relationshipScore,
      lastContactedAt: b.lastContactedAt,
      title: `Wish ${b.name} a happy birthday`,
      hasCheckAction: false, // birthday rows have no check action
      dueChip: {
        text: describeDueChip(b.daysUntil, b.nextDate),
        variant: b.daysUntil === 0 ? "today" : "neutral",
      },
    }));

  // Every row the server sent, in its order: the furthest past due first.
  const catchUpItems: UpNextItem[] = catchUp.map((contact) => ({
    id: `catch-${contact.id}`,
    kind: "catch-up",
    group: "catch-up",
    contactId: contact.id,
    contactName: contact.name,
    contactAvatarUrl: contact.avatarUrl ?? null,
    // Every contact on this list is tracked: that is the rule that put it here.
    isTracked: true,
    relationshipScore: contact.relationshipScore,
    lastContactedAt: contact.lastContactedAt ?? null,
    title: `Check in with ${contact.name}`,
    hasCheckAction: false, // a catch-up has a Log button, not a check
    dueChip: {
      text: describePastDue(contact.overshootDays),
      variant: "neutral",
    },
  }));

  const allItems = [
    ...overdueItems,
    ...todayItems,
    ...thisWeekItems,
    ...birthdayItems,
    ...catchUpItems,
  ];

  const groupOrder: UpNextGroup[] = [
    "overdue",
    "today",
    "thisWeek",
    "birthdays",
    "catch-up",
  ];
  const groupItemsMap: Record<UpNextGroup, UpNextItem[]> = {
    overdue: overdueItems,
    today: todayItems,
    thisWeek: thisWeekItems,
    birthdays: birthdayItems,
    "catch-up": catchUpItems,
  };

  const groups: UpNextGroupMeta[] = groupOrder
    .map((group): UpNextGroupMeta => {
      const items = groupItemsMap[group];
      const meta: UpNextGroupMeta = {
        group,
        label: GROUP_LABELS[group],
        items,
        count: items.length,
      };
      if (
        group === "catch-up" &&
        catchUpCount !== undefined &&
        catchUpCount > items.length
      ) {
        meta.of = catchUpCount;
      }
      return meta;
    })
    .filter((g) => g.count > 0);

  return {
    items: allItems,
    groups,
    counts: {
      overdue: overdueItems.length,
      today: todayItems.length,
      thisWeek: thisWeekItems.length,
      birthdays: birthdayItems.length,
      catchUp: catchUpItems.length,
      total: allItems.length,
    },
  };
}

/**
 * Calculates the next highlight index when items change.
 * Ensures the highlighted index survives a completed row leaving.
 */
export function computeNextHighlightIndex(
  prevIndex: number,
  prevItems: readonly UpNextItem[],
  nextItems: readonly UpNextItem[],
): number {
  if (nextItems.length === 0) return -1;
  if (prevIndex < 0) return 0;

  const prevItem = prevItems[prevIndex];
  if (prevItem) {
    const nextIdx = nextItems.findIndex((item) => item.id === prevItem.id);
    if (nextIdx >= 0) {
      return nextIdx;
    }
  }

  // Clamped to valid range if the previous item was removed
  return Math.min(Math.max(0, prevIndex), nextItems.length - 1);
}
