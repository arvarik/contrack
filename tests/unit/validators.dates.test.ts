// =============================================================================
// pastDateSchema — an interaction is something that happened
// =============================================================================
// `contacts.lastContactedAt` is the newest interaction date, and the relationship
// score reads it. `recencyScore` returns 100 for a date at or ahead of now and
// 91.68 one millisecond later, so a single future interaction pins a contact's
// recency signal, which carries 40 percent of the composite, at full marks
// until a real interaction replaces it. Recorded as A-05 in `.agent/STATUS.md`.
//
// This schema is the first of two guards. It refuses the write and says why,
// which is the answer somebody can act on. The second is the `MIN` in
// `interactionService`, which closes the clock slack this one allows and the
// rows an older version already wrote.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  dateSchema,
  pastDateSchema,
  interactionCreateSchema,
  contactCreateSchema,
} from "../../server/utils/validators.ts";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("pastDateSchema", () => {
  it("accepts a timestamp in the past", () => {
    expect(pastDateSchema.safeParse(iso(-DAY)).success).toBe(true);
  });

  it("accepts now", () => {
    expect(pastDateSchema.safeParse(iso(0)).success).toBe(true);
  });

  it("accepts a clock a minute ahead of the server", () => {
    // The reason the tolerance exists. A browser whose clock runs fast stamps
    // "I just spoke to them" as the near future, and that is an honest write.
    expect(pastDateSchema.safeParse(iso(60_000)).success).toBe(true);
  });

  it("refuses a clock an hour ahead", () => {
    const result = pastDateSchema.safeParse(iso(HOUR));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Date cannot be in the future",
      );
    }
  });

  it("refuses a timestamp next year", () => {
    expect(pastDateSchema.safeParse(iso(365 * DAY)).success).toBe(false);
  });

  const dayOnly = (offsetMs: number) =>
    new Date(Date.now() + offsetMs).toISOString().slice(0, 10);

  it("accepts today as a date with no time", () => {
    expect(pastDateSchema.safeParse(dayOnly(0)).success).toBe(true);
  });

  it("accepts yesterday as a date with no time", () => {
    expect(pastDateSchema.safeParse(dayOnly(-DAY)).success).toBe(true);
  });

  it("accepts tomorrow as a date with no time", () => {
    // Deliberate. A client in UTC+13 logging a call today sends a local date
    // that is tomorrow in UTC, and refusing it would refuse an honest write.
    // A date with no time parses to midnight, so it cannot reach the cliff
    // this schema exists for, and the `MIN` in interactionService clamps the
    // stored value regardless.
    expect(pastDateSchema.safeParse(dayOnly(DAY)).success).toBe(true);
  });

  it("refuses a date three days out", () => {
    expect(pastDateSchema.safeParse(dayOnly(3 * DAY)).success).toBe(false);
  });

  it("refuses a value that is not a date at all", () => {
    expect(pastDateSchema.safeParse("last tuesday").success).toBe(false);
  });

  it("normalizes to UTC the way dateSchema does", () => {
    const result = pastDateSchema.parse("2020-06-01T12:00:00+02:00");
    expect(result).toBe("2020-06-01T10:00:00.000Z");
  });
});

describe("the schemas that use it", () => {
  it("refuses a future interaction date", () => {
    const result = interactionCreateSchema.safeParse({
      type: "call",
      title: "A call that has not happened",
      date: iso(7 * DAY),
    });
    expect(result.success).toBe(false);
  });

  it("accepts an interaction with no date at all", () => {
    // The server stamps its own now, which is the common path.
    expect(
      interactionCreateSchema.safeParse({ type: "call", title: "A call" })
        .success,
    ).toBe(true);
  });

  it("leaves a follow-up free to be in the future", () => {
    // `nextFollowUpAt` is supposed to be ahead of now, which is why this is a
    // second schema rather than a change to `dateSchema`.
    expect(dateSchema.safeParse(iso(30 * DAY)).success).toBe(true);
    expect(
      contactCreateSchema.safeParse({
        name: "Anton Kovacs",
        nextFollowUpAt: iso(30 * DAY),
      }).success,
    ).toBe(true);
  });

  it("still refuses a future action-item due date nowhere", () => {
    // An action item is due in the future by definition, so it keeps
    // `dateSchema` too. Stated as a test because the two live side by side in
    // one object and it would be easy to change the wrong one.
    expect(
      interactionCreateSchema.safeParse({
        type: "call",
        title: "A call",
        actionItem: { title: "Send the deck", dueAt: iso(7 * DAY) },
      }).success,
    ).toBe(true);
  });
});
