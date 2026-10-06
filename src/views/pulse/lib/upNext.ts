/**
 * The Up next queue, in groups: overdue (oldest first), due today, this
 * week, birthdays this week, then catch-ups. A catch-up ranks last because it
 * is a soft reminder, and a due follow-up is a promise with a date.
 */
import { differenceInCalendarDays } from "date-fns";
import type { ActionItem } from "../../../types";
import type { CatchUpCard } from "../../../../shared/pulse";
import { describePastDue } from "../../../../shared/pastDue";
import { parseServerTime } from "../../../lib/datetime";
import type { UpcomingBirthday } from "./birthdays";

export type UpNextGroup =
  "overdue" | "today" | "thisWeek" | "birthdays" | "catch-up";

type UpNextItemKind = "action_item" | "birthday" | "catch-up";

/**
 * The ring's fields, from the slim contact cache, because an action item
 * holds no score. A row whose contact is missing shows the picture alone.
 */
interface UpNextContactScore {
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
  /** A follow-up's due date as the server sent it. Snooze's Undo puts it back. */
  dueAt?: string;
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
  /** The total when it is more than the rows shown, for "10 of 14". */
  of?: number;
}

interface UpNextResult {
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

interface BuildUpNextOptions {
  overdue?: ActionItem[];
  dueToday?: ActionItem[];
  upcoming?: ActionItem[];
  birthdays?: UpcomingBirthday[];
  /** The server's Catch up list, ten at most, the furthest past due first. */
  catchUp?: CatchUpCard[];
  /** How many catch-ups there are in all, past the ten. */
  catchUpCount?: number;
  /** The ring fields for every contact, by contact id. */
  contactScores?: ReadonlyMap<string, UpNextContactScore>;
  now?: Date;
}

const GROUP_LABELS: Record<UpNextGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  birthdays: "Birthdays",
  "catch-up": "Catch up",
};

/**
 * The words on a due chip. `daysFromNow` is negative for a past date. A past
 * date counts its days ("12 days overdue"), because a bare "Overdue" repeats
 * the group heading and hides how late it is. Inside the week the chip names
 * the weekday when it has the date.
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

  const followUpRow = (
    item: ActionItem,
    group: UpNextGroup,
    dueChip: UpNextItem["dueChip"],
  ): UpNextItem => ({
    id: item.id,
    kind: "action_item",
    group,
    contactId: item.contactId,
    contactName: item.contactName ?? "",
    contactAvatarUrl: item.contactAvatarUrl ?? null,
    ...ringOf(item.contactId),
    title: item.title,
    hasCheckAction: true,
    dueAt: item.dueAt,
    dueChip,
  });

  /** Soonest due first. */
  const byDue = (a: ActionItem, b: ActionItem) =>
    (parseServerTime(a.dueAt)?.getTime() ?? 0) -
    (parseServerTime(b.dueAt)?.getTime() ?? 0);

  // The server put the row in Overdue, so it is at least a day late whatever
  // the browser's clock says. `parseServerTime` reads a date with no time as
  // local midnight, as the contact page's banner does: UTC midnight counts a
  // day too many west of Greenwich.
  const overdueItems = [...overdue].sort(byDue).map((item) => {
    const due = parseServerTime(item.dueAt);
    const daysLate = due
      ? Math.min(-1, differenceInCalendarDays(due, now))
      : -1;
    return followUpRow(item, "overdue", {
      text: describeDueChip(daysLate),
      variant: "urgent",
    });
  });

  const todayItems = dueToday.map((item) =>
    followUpRow(item, "today", { text: describeDueChip(0), variant: "today" }),
  );

  // In this bucket the date is after today, so at least a day out.
  const thisWeekItems = [...upcoming].sort(byDue).map((item) => {
    const due = parseServerTime(item.dueAt);
    return followUpRow(item, "thisWeek", {
      text: due
        ? describeDueChip(Math.max(1, differenceInCalendarDays(due, now)), due)
        : "Upcoming",
      variant: "upcoming",
    });
  });

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
      hasCheckAction: false,
      dueChip: {
        text: describeDueChip(b.daysUntil, b.nextDate),
        variant: b.daysUntil === 0 ? "today" : "neutral",
      },
    }));

  // In the server's order, the furthest past due first.
  const catchUpItems: UpNextItem[] = catchUp.map((contact) => ({
    id: `catch-${contact.id}`,
    kind: "catch-up",
    group: "catch-up",
    contactId: contact.id,
    contactName: contact.name,
    contactAvatarUrl: contact.avatarUrl ?? null,
    // The server lists only tracked contacts.
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
 * Keeps the highlight on the same row when the items change, and clamps it
 * when that row left, such as a completed follow-up.
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

  return Math.min(Math.max(0, prevIndex), nextItems.length - 1);
}
