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
import type { ActionItem } from "../../../types";
import type { CatchUpCard } from "../../../../shared/pulse";
import { describePastDue } from "../../../../shared/pastDue";
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
  contactThemeColor: string;
  /** A person tracks this contact, so its ring means something. */
  isTracked: boolean;
  relationshipScore: number | null;
  lastContactedAt: string | null;
  title: string;
  dueAt: string | null;
  hasCheckAction: boolean;
  dueChip: {
    text: string;
    variant: "urgent" | "today" | "upcoming" | "neutral";
  };
  turningAge?: number | null;
  daysSinceContact?: number | null;
  originalActionItem?: ActionItem;
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

export const GROUP_LABELS: Record<UpNextGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  birthdays: "Birthdays",
  "catch-up": "Catch up",
};

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
      const timeA = a.dueAt ? new Date(a.dueAt).getTime() : 0;
      const timeB = b.dueAt ? new Date(b.dueAt).getTime() : 0;
      return timeA - timeB; // Oldest dueAt first
    })
    .map((item) => {
      const diffDays = item.dueAt
        ? Math.max(
            1,
            Math.round(
              (now.getTime() - new Date(item.dueAt).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          )
        : 1;
      return {
        id: item.id,
        kind: "action_item",
        group: "overdue",
        contactId: item.contactId,
        contactName: item.contactName ?? "",
        contactAvatarUrl: item.contactAvatarUrl ?? null,
        contactThemeColor: item.contactThemeColor ?? "#006a91",
        ...ringOf(item.contactId),
        title: item.title,
        dueAt: item.dueAt,
        hasCheckAction: true,
        dueChip: {
          text: diffDays > 1 ? `${diffDays}d overdue` : "Overdue",
          variant: "urgent",
        },
        originalActionItem: item,
      };
    });

  const todayItems: UpNextItem[] = dueToday.map((item) => ({
    id: item.id,
    kind: "action_item",
    group: "today",
    contactId: item.contactId,
    contactName: item.contactName ?? "",
    contactAvatarUrl: item.contactAvatarUrl ?? null,
    contactThemeColor: item.contactThemeColor ?? "#006a91",
    ...ringOf(item.contactId),
    title: item.title,
    dueAt: item.dueAt,
    hasCheckAction: true,
    dueChip: {
      text: "Today",
      variant: "today",
    },
    originalActionItem: item,
  }));

  const thisWeekItems: UpNextItem[] = [...upcoming]
    .sort((a, b) => {
      const timeA = a.dueAt ? new Date(a.dueAt).getTime() : 0;
      const timeB = b.dueAt ? new Date(b.dueAt).getTime() : 0;
      return timeA - timeB;
    })
    .map((item) => {
      let label = "Upcoming";
      if (item.dueAt) {
        try {
          const d = new Date(item.dueAt);
          label = d.toLocaleDateString(undefined, { weekday: "short" });
        } catch {
          label = "Upcoming";
        }
      }
      return {
        id: item.id,
        kind: "action_item",
        group: "thisWeek",
        contactId: item.contactId,
        contactName: item.contactName ?? "",
        contactAvatarUrl: item.contactAvatarUrl ?? null,
        contactThemeColor: item.contactThemeColor ?? "#006a91",
        ...ringOf(item.contactId),
        title: item.title,
        dueAt: item.dueAt,
        hasCheckAction: true,
        dueChip: {
          text: label,
          variant: "upcoming",
        },
        originalActionItem: item,
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
      contactThemeColor: b.themeColor,
      isTracked: b.isTracked,
      relationshipScore: b.relationshipScore,
      lastContactedAt: b.lastContactedAt,
      title: `Wish ${b.name} a happy birthday`,
      dueAt: null,
      hasCheckAction: false, // birthday rows have no check action
      dueChip: {
        text:
          b.daysUntil === 0
            ? "Today"
            : b.daysUntil === 1
              ? "Tomorrow"
              : `In ${b.daysUntil}d`,
        variant: b.daysUntil === 0 ? "today" : "neutral",
      },
      turningAge: b.turningAge,
    }));

  // Every row the server sent, in its order: the furthest past due first.
  const catchUpItems: UpNextItem[] = catchUp.map((contact) => ({
    id: `catch-${contact.id}`,
    kind: "catch-up",
    group: "catch-up",
    contactId: contact.id,
    contactName: contact.name,
    contactAvatarUrl: contact.avatarUrl ?? null,
    contactThemeColor: contact.themeColor ?? "#006a91",
    // Every contact on this list is tracked: that is the rule that put it here.
    isTracked: true,
    relationshipScore: contact.relationshipScore,
    lastContactedAt: contact.lastContactedAt ?? null,
    title: `Check in with ${contact.name}`,
    dueAt: null,
    hasCheckAction: false, // a catch-up has a Log button, not a check
    dueChip: {
      text: describePastDue(contact.overshootDays),
      variant: "neutral",
    },
    daysSinceContact: contact.daysSince,
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
