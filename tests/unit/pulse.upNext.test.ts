import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import {
  buildUpNextQueue,
  computeNextHighlightIndex,
  describeDueChip,
  GROUP_LABELS,
} from "../../src/views/pulse/lib/upNext";
import type { ActionItem } from "../../src/types";
import type { UpcomingBirthday } from "../../src/views/pulse/lib/birthdays";
import type { CatchUpCard } from "../../shared/pulse";

/** A tracked contact past its cadence, as the server sends it. */
const catchUpCard = (
  id: string,
  name: string,
  overshootDays: number,
  extra: Partial<CatchUpCard> = {},
): CatchUpCard => ({
  id,
  name,
  company: null,
  avatarUrl: null,
  themeColor: "#006a91",
  relationshipScore: 35,
  lastContactedAt: "2026-08-01T10:00:00.000Z",
  cadenceDays: 30,
  daysSince: 30 + overshootDays,
  overshootDays,
  ...extra,
});

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

  it("ranks items strictly in order: overdue (oldest first) -> today -> this week -> birthdays -> catch up", () => {
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
      isTracked: true,
      lastContactedAt: "2026-09-01T10:00:00.000Z",
      relationshipScore: 85,
      daysUntil: 2,
      turningAge: 36,
      nextDate: new Date("2026-09-19"),
    };

    const catchUp = catchUpCard("c-catch", "Bob Stone", 15);

    const res = buildUpNextQueue({
      overdue: [overdueNewer, overdueOlder], // intentionally out of order
      dueToday: [todayItem],
      upcoming: [thisWeekItem],
      birthdays: [bday],
      catchUp: [catchUp],
      now: new Date("2026-09-17T12:00:00.000Z"),
    });

    expect(res.items.map((i) => i.id)).toEqual([
      "ov-1", // Oldest overdue first
      "ov-2",
      "td-1",
      "tw-1",
      "bday-c-bday",
      "catch-c-catch",
    ]);

    expect(res.groups.map((g) => g.group)).toEqual([
      "overdue",
      "today",
      "thisWeek",
      "birthdays",
      "catch-up",
    ]);
  });

  it("gives a catch-up row the Log action, the ring fields, and the past-due words", () => {
    const res = buildUpNextQueue({
      catchUp: [
        catchUpCard("c1", "Ada Lovelace", 1),
        catchUpCard("c2", "Grace Hopper", 12),
        catchUpCard("c3", "Edsger Dijkstra", 21),
        catchUpCard("c4", "Linus Torvalds", 70),
      ],
    });
    const rows = res.items;
    expect(rows.map((r) => r.dueChip.text)).toEqual([
      "1 day past due",
      "12 days past due",
      "3 weeks past due",
      "2 months past due",
    ]);
    expect(rows[0]).toMatchObject({
      kind: "catch-up",
      group: "catch-up",
      hasCheckAction: false,
      title: "Check in with Ada Lovelace",
      isTracked: true,
      relationshipScore: 35,
      lastContactedAt: "2026-08-01T10:00:00.000Z",
    });
    expect(rows[0].dueChip.variant).toBe("neutral");
    expect(res.groups[0].label).toBe("Catch up");
  });

  it("ensures a birthday row has no check action", () => {
    const bday: UpcomingBirthday = {
      contactId: "c-bday",
      name: "Grace Hopper",
      avatarUrl: null,
      isTracked: true,
      lastContactedAt: "2026-09-01T10:00:00.000Z",
      relationshipScore: 90,
      daysUntil: 1,
      turningAge: null,
      nextDate: new Date("2026-09-18"),
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

  it("takes every catch-up row the server sends, in its order, and says how many wait", () => {
    // The server sends ten at most, the furthest past due first. The group
    // takes them all and the heading reads "10 of 14".
    const ten = Array.from({ length: 10 }, (_, i) =>
      catchUpCard(`s${i}`, `Person ${i}`, 40 - i),
    );

    const res = buildUpNextQueue({ catchUp: ten, catchUpCount: 14 });

    expect(res.items).toHaveLength(10);
    expect(res.counts.catchUp).toBe(10);
    expect(res.items.map((i) => i.contactId)).toEqual(ten.map((c) => c.id));
    expect(res.groups[0]).toMatchObject({
      group: "catch-up",
      count: 10,
      of: 14,
    });

    // With no more waiting, the heading is the count alone.
    const all = buildUpNextQueue({ catchUp: ten, catchUpCount: 10 });
    expect(all.groups[0].of).toBeUndefined();
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
          isTracked: false,
          lastContactedAt: null,
          relationshipScore: null,
          daysUntil: 3,
          turningAge: null,
          nextDate: new Date(),
        },
      ],
      catchUp: [catchUpCard("s1", "S", 30)],
    });

    expect(res.counts).toEqual({
      overdue: 1,
      today: 2,
      thisWeek: 1,
      birthdays: 1,
      catchUp: 1,
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

  describe("describeDueChip", () => {
    const weekday = (d: Date) =>
      d.toLocaleDateString(undefined, { weekday: "long" });

    it("speaks in sentence case: overdue days, today, tomorrow, the weekday, in N days", () => {
      // A late row counts its days from the first one: the Overdue heading
      // above it already says "Overdue".
      expect(describeDueChip(-1)).toBe("1 day overdue");
      expect(describeDueChip(-12)).toBe("12 days overdue");
      expect(describeDueChip(0)).toBe("Today");
      expect(describeDueChip(1)).toBe("Tomorrow");
      const wednesday = new Date(2026, 8, 23, 15);
      expect(describeDueChip(2, wednesday)).toBe(weekday(wednesday));
      expect(describeDueChip(2)).toBe("In 2 days");
      // A week out is the same weekday as today, so the chip counts instead.
      expect(describeDueChip(7, new Date(2026, 8, 28))).toBe("In 7 days");
      expect(describeDueChip(9)).toBe("In 9 days");
    });

    it("feeds every chip in the queue", () => {
      const now = new Date(2026, 8, 21, 9); // Monday
      const wednesday = new Date(2026, 8, 23, 15);
      const result = buildUpNextQueue({
        now,
        overdue: [
          mockActionItem(
            "ov-old",
            "Old",
            new Date(2026, 8, 9, 10).toISOString(),
          ),
          mockActionItem(
            "ov-new",
            "New",
            new Date(2026, 8, 20, 10).toISOString(),
          ),
        ],
        dueToday: [
          mockActionItem(
            "td",
            "Today",
            new Date(2026, 8, 21, 16).toISOString(),
          ),
        ],
        upcoming: [
          mockActionItem("tw", "Midweek", wednesday.toISOString()),
          mockActionItem(
            "tm",
            "Tomorrow",
            new Date(2026, 8, 22, 10).toISOString(),
          ),
        ],
        birthdays: [
          {
            contactId: "b1",
            name: "Ada",
            avatarUrl: null,
            isTracked: false,
            lastContactedAt: null,
            relationshipScore: null,
            daysUntil: 2,
            turningAge: 40,
            nextDate: wednesday,
          },
        ],
        catchUp: [catchUpCard("c9", "Grace", 21)],
      });
      const chips = Object.fromEntries(
        result.items.map((item) => [item.id, item.dueChip.text]),
      );
      expect(chips).toEqual({
        "ov-old": "12 days overdue",
        "ov-new": "1 day overdue",
        td: "Today",
        tm: "Tomorrow",
        tw: weekday(wednesday),
        "bday-b1": weekday(wednesday),
        "catch-c9": "3 weeks past due",
      });
      // Nothing in a chip is shouted.
      for (const text of Object.values(chips)) {
        expect(text).not.toMatch(/[A-Z]{2,}/);
      }
    });
  });

  it("names the groups in sentence case", () => {
    expect(Object.values(GROUP_LABELS)).toEqual([
      "Overdue",
      "Today",
      "This week",
      "Birthdays",
      "Catch up",
    ]);
  });

  it("keeps a birthday in Up next through the seventh day and not the eighth", () => {
    const birthday = (contactId: string, daysUntil: number) => ({
      contactId,
      name: contactId,
      avatarUrl: null,
      isTracked: false,
      lastContactedAt: null,
      relationshipScore: null,
      daysUntil,
      turningAge: null,
      nextDate: new Date(2026, 8, 21 + daysUntil),
    });
    const result = buildUpNextQueue({
      birthdays: [birthday("seven", 7), birthday("eight", 8)],
    });
    expect(result.items.map((i) => i.id)).toEqual(["bday-seven"]);
    expect(result.counts.birthdays).toBe(1);
  });
});

describe("pulse.upNext reads a date with no time as a local day", () => {
  // The follow-up dialog writes "2026-09-19". Read as UTC midnight it is
  // 5 PM the day before in Los Angeles, so the chip said a day more than
  // the contact page's banner, which reads the local day.
  const item = (id: string, dueAt: string): ActionItem => ({
    id,
    contactId: "c1",
    contactName: "Alice",
    title: "Follow up",
    dueAt,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });

  beforeAll(() => {
    vi.stubEnv("TZ", "America/Los_Angeles");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("counts the calendar days late, and names the weekday due, as the banner does", () => {
    // 6 PM on Tuesday, September 22, 2026, in Los Angeles.
    const now = new Date("2026-09-23T01:00:00.000Z");
    const queue = buildUpNextQueue({
      overdue: [item("late", "2026-09-19")],
      upcoming: [item("soon", "2026-09-25")],
      now,
    });
    const chip = (id: string) =>
      queue.items.find((i) => i.id === id)?.dueChip.text;
    expect(chip("late")).toBe("3 days overdue");
    expect(chip("soon")).toBe("Friday");
  });
});
