// Unit: pastDateSchema. An interaction is something that happened.
// `contacts.lastContactedAt` is the newest interaction date. `recencyScore`
// returns 100 for a date at or ahead of now and 91.68 one millisecond later,
// so one future interaction pins 40 percent of the composite at full marks.
// `.agent/STATUS.md` keeps the discontinuity as an open issue.
//
// This schema is the first of two guards: it refuses the write and says why.
// The second is the `MIN` in `interactionService`, which closes the clock
// slack this one allows and rows already written ahead of now.

import { describe, it, expect } from "vitest";
import {
  dateSchema,
  pastDateSchema,
} from "../../../../shared/contracts/common.ts";
import { interactionCreateSchema } from "../../../../shared/contracts/interactions.ts";
import { contactCreateSchema } from "../../../../shared/contracts/contacts.ts";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("pastDateSchema", () => {
  const dayOnly = (offsetMs: number) =>
    new Date(Date.now() + offsetMs).toISOString().slice(0, 10);

  it("accepts past/now timestamps, 1-minute clock skew, and date-only strings up to tomorrow, normalizing to UTC", () => {
    for (const input of [
      iso(-DAY),
      iso(0),
      iso(60_000),
      dayOnly(-DAY),
      dayOnly(0),
      dayOnly(DAY),
    ]) {
      expect(pastDateSchema.safeParse(input).success, input).toBe(true);
    }
    expect(pastDateSchema.parse("2020-06-01T12:00:00+02:00")).toBe(
      "2020-06-01T10:00:00.000Z",
    );
  });

  it("refuses future timestamps, dates three days out, and non-dates", () => {
    const result = pastDateSchema.safeParse(iso(HOUR));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Date cannot be in the future",
      );
    }
    for (const bad of [iso(365 * DAY), dayOnly(3 * DAY), "last tuesday"]) {
      expect(pastDateSchema.safeParse(bad).success, bad).toBe(false);
    }
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
