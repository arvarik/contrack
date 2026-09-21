import { describe, it, expect } from "vitest";
import {
  buildUpNextQueue,
  computeNextHighlightIndex,
} from "../../src/views/pulse/lib/upNext";
import type { ActionItem } from "../../src/types";
import type { UpcomingBirthday } from "../../src/views/pulse/lib/birthdays";
import type { SlippingContactInput } from "../../src/views/pulse/lib/upNext";

describe("pulse.upNext", () => {
  const mockActionItem = (
    id: string,
    title: string,
    dueAt: string,
    contactId = "c1",
    contactName = "Alice",
  ): ActionItem => ({
    id,
    contactId,
    contactName,
    title,
    dueAt,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });

  it("ranks items strictly in order: overdue (oldest first) -> today -> this week -> birthdays -> slipping", () => {
    const overdueOlder = mockActionItem(
      "ov-1",
      "Older Overdue",
      "2026-09-10T10:00:00.000Z",
    );
    const overdueNewer = mockActionItem(
      "ov-2",
      "Newer Overdue",
      "2026-09-15T10:00:00.000Z",
    );
    const todayItem = mockActionItem(
      "td-1",
      "Due Today",
      "2026-09-17T12:00:00.000Z",
    );
    const thisWeekItem = mockActionItem(
      "tw-1",
      "Due Friday",
      "2026-09-19T15:00:00.000Z",
    );

    const bday: UpcomingBirthday = {
      contactId: "c-bday",
      name: "Ada Lovelace",
      avatarUrl: null,
      themeColor: "#10b981",
      isTracked: true,
      lastContactedAt: "2026-09-01T10:00:00.000Z",
      relationshipScore: 85,
      daysUntil: 2,
      turningAge: 36,
      nextDate: new Date("2026-09-19"),
      rawBirthday: "1990-09-19",
    };

    const slip: SlippingContactInput = {
      id: "c-slip",
      name: "Bob Stone",
      relationshipScore: 35,
      daysSinceContact: 45,
      lastInteractionTitle: "Coffee catch up",
    };

    const res = buildUpNextQueue({
      overdue: [overdueNewer, overdueOlder], // intentionally out of order
      dueToday: [todayItem],
      upcoming: [thisWeekItem],
      birthdays: [bday],
      slipping: [slip],
      now: new Date("2026-09-17T12:00:00.000Z"),
    });

    expect(res.items.map((i) => i.id)).toEqual([
      "ov-1", // Oldest overdue first
      "ov-2",
      "td-1",
      "tw-1",
      "bday-c-bday",
      "slip-c-slip",
    ]);

    expect(res.groups.map((g) => g.group)).toEqual([
      "overdue",
      "today",
      "thisWeek",
      "birthdays",
      "slipping",
    ]);
  });

  it("ensures a birthday row has no check action", () => {
    const bday: UpcomingBirthday = {
      contactId: "c-bday",
      name: "Grace Hopper",
      avatarUrl: null,
      themeColor: "#3b82f6",
      isTracked: true,
      lastContactedAt: "2026-09-01T10:00:00.000Z",
      relationshipScore: 90,
      daysUntil: 1,
      turningAge: null,
      nextDate: new Date("2026-09-18"),
      rawBirthday: "09-18",
    };

    const res = buildUpNextQueue({
      birthdays: [bday],
    });

    expect(res.items).toHaveLength(1);
    const row = res.items[0];
    expect(row.kind).toBe("birthday");
    expect(row.hasCheckAction).toBe(false);
    expect(row.title).toBe("Wish Grace Hopper a happy birthday");
  });

  it("caps slipping rows at at most three", () => {
    const slippingContacts: SlippingContactInput[] = [
      { id: "s1", name: "One", relationshipScore: 20, daysSinceContact: 50 },
      { id: "s2", name: "Two", relationshipScore: 25, daysSinceContact: 45 },
      { id: "s3", name: "Three", relationshipScore: 30, daysSinceContact: 40 },
      { id: "s4", name: "Four", relationshipScore: 32, daysSinceContact: 35 },
      { id: "s5", name: "Five", relationshipScore: 38, daysSinceContact: 32 },
    ];

    const res = buildUpNextQueue({
      slipping: slippingContacts,
    });

    expect(res.items).toHaveLength(3);
    expect(res.counts.slipping).toBe(3);
    expect(res.items.map((i) => i.contactId)).toEqual(["s1", "s2", "s3"]);
  });

  it("calculates accurate group and total counts", () => {
    const res = buildUpNextQueue({
      overdue: [mockActionItem("o1", "O1", "2026-09-10")],
      dueToday: [
        mockActionItem("t1", "T1", "2026-09-17"),
        mockActionItem("t2", "T2", "2026-09-17"),
      ],
      upcoming: [mockActionItem("u1", "U1", "2026-09-20")],
      birthdays: [
        {
          contactId: "b1",
          name: "B",
          avatarUrl: null,
          themeColor: "#000",
          isTracked: false,
          lastContactedAt: null,
          relationshipScore: null,
          daysUntil: 3,
          turningAge: null,
          nextDate: new Date(),
          rawBirthday: "10-10",
        },
      ],
      slipping: [
        { id: "s1", name: "S", relationshipScore: 10, daysSinceContact: 60 },
      ],
    });

    expect(res.counts).toEqual({
      overdue: 1,
      today: 2,
      thisWeek: 1,
      birthdays: 1,
      slipping: 1,
      total: 6,
    });
  });

  it("ensures the highlighted index survives a completed row leaving", () => {
    const item1 = mockActionItem("1", "Task 1", "2026-09-17");
    const item2 = mockActionItem("2", "Task 2", "2026-09-17");
    const item3 = mockActionItem("3", "Task 3", "2026-09-17");

    const queueBefore = buildUpNextQueue({
      dueToday: [item1, item2, item3],
    });

    // User is highlighting index 1 (Task 2)
    const prevIndex = 1;

    // Task 2 is completed, leaves the queue
    const queueAfter = buildUpNextQueue({
      dueToday: [item1, item3],
    });

    // Highlight index should remain 1 (now pointing to Task 3)
    const nextIndex = computeNextHighlightIndex(
      prevIndex,
      queueBefore.items,
      queueAfter.items,
    );
    expect(nextIndex).toBe(1);
    expect(queueAfter.items[nextIndex].id).toBe("3");

    // Completing the last item clamps to the new last item
    const queueLast = buildUpNextQueue({
      dueToday: [item1],
    });
    const lastIndex = computeNextHighlightIndex(
      1,
      queueAfter.items,
      queueLast.items,
    );
    expect(lastIndex).toBe(0);
    expect(queueLast.items[lastIndex].id).toBe("1");

    // When empty, returns -1
    const emptyQueue = buildUpNextQueue({});
    expect(
      computeNextHighlightIndex(0, queueLast.items, emptyQueue.items),
    ).toBe(-1);
  });
});
