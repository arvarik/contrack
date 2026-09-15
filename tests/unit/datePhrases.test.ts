// =============================================================================
// Unit Tests — date phrases in a question
// =============================================================================
// "Last month" is a calendar month in the caller's zone, ending at that
// zone's midnight. Every expectation below is an exact instant, because an
// off-by-one-zone here is a whole evening of notes at each end of the range.
//
// `now` is Monday 14 September 2026, 17:30 UTC, which is 10:30 in Los
// Angeles and 23:00 in Kolkata.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  boundFromFilter,
  extractDatePhrase,
  isValidTimeZone,
} from "../../server/services/search/datePhrases.ts";

const now = new Date("2026-09-14T17:30:00.000Z");
const at = (zone: string) => ({ now, timeZone: zone });

describe("extractDatePhrase: calendar periods", () => {
  it("reads 'last month' as the previous calendar month in UTC", () => {
    const out = extractDatePhrase(
      "Who discussed hiring last month?",
      at("UTC"),
    );
    expect(out.range).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
      phrase: "last month",
    });
    expect(out.text).toBe("Who discussed hiring ?");
  });

  it("reads 'last month' in the caller's zone, not the UTC month", () => {
    const out = extractDatePhrase(
      "hiring last month",
      at("America/Los_Angeles"),
    );
    expect(out.range?.from).toBe("2026-08-01T07:00:00.000Z");
    expect(out.range?.to).toBe("2026-09-01T07:00:00.000Z");
    expect(out.text).toBe("hiring");
  });

  it("starts weeks on Monday", () => {
    // 14 September 2026 is a Monday, so "this week" starts today.
    expect(extractDatePhrase("this week", at("UTC")).range).toMatchObject({
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-21T00:00:00.000Z",
    });
    expect(extractDatePhrase("last week", at("UTC")).range).toMatchObject({
      from: "2026-09-07T00:00:00.000Z",
      to: "2026-09-14T00:00:00.000Z",
    });
  });

  it("reads today and yesterday by the caller's clock", () => {
    // 17:30 UTC is already 23:00 in Kolkata, so yesterday there is the 13th.
    expect(
      extractDatePhrase("yesterday", at("Asia/Kolkata")).range,
    ).toMatchObject({
      from: "2026-09-12T18:30:00.000Z",
      to: "2026-09-13T18:30:00.000Z",
    });
    expect(extractDatePhrase("today", at("UTC")).range).toMatchObject({
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-15T00:00:00.000Z",
    });
  });

  it("reads quarters and years", () => {
    expect(extractDatePhrase("this quarter", at("UTC")).range).toMatchObject({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
    expect(extractDatePhrase("last quarter", at("UTC")).range).toMatchObject({
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });
    expect(extractDatePhrase("previous year", at("UTC")).range).toMatchObject({
      from: "2025-01-01T00:00:00.000Z",
      to: "2026-01-01T00:00:00.000Z",
    });
    expect(extractDatePhrase("this year", at("UTC")).range).toMatchObject({
      from: "2026-01-01T00:00:00.000Z",
      to: "2027-01-01T00:00:00.000Z",
    });
  });

  it("crosses a daylight-saving change without drifting an hour", () => {
    // October 2026 in New York starts and ends in EDT; November starts in
    // EDT too (the change is on 1 November at 02:00), so both bounds are 04:00Z.
    const out = extractDatePhrase("last month", {
      now: new Date("2026-11-10T12:00:00.000Z"),
      timeZone: "America/New_York",
    });
    expect(out.range).toMatchObject({
      from: "2026-10-01T04:00:00.000Z",
      to: "2026-11-01T04:00:00.000Z",
    });
    // And the month after the change ends at 05:00Z, which is EST midnight.
    const winter = extractDatePhrase("this month", {
      now: new Date("2026-11-20T12:00:00.000Z"),
      timeZone: "America/New_York",
    });
    expect(winter.range?.to).toBe("2026-12-01T05:00:00.000Z");
  });
});

describe("extractDatePhrase: rolling windows", () => {
  it("reads 'in the last 30 days' as a window ending now", () => {
    const out = extractDatePhrase("coffee in the last 30 days", at("UTC"));
    expect(out.range).toEqual({
      from: "2026-08-15T17:30:00.000Z",
      to: "2026-09-14T17:30:00.000Z",
      phrase: "in the last 30 days",
    });
    expect(out.text).toBe("coffee");
  });

  it("reads written numbers and the other units", () => {
    expect(extractDatePhrase("past two weeks", at("UTC")).range?.from).toBe(
      "2026-08-31T17:30:00.000Z",
    );
    expect(extractDatePhrase("last 3 months", at("UTC")).range?.from).toBe(
      "2026-06-14T00:00:00.000Z",
    );
    expect(extractDatePhrase("past twelve months", at("UTC")).range?.from).toBe(
      "2025-09-14T00:00:00.000Z",
    );
  });

  it("reads 'last year' with no number as the calendar year", () => {
    expect(
      extractDatePhrase("over the last year", at("UTC")).range,
    ).toMatchObject({
      from: "2025-01-01T00:00:00.000Z",
      to: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("extractDatePhrase: named months, years and days", () => {
  it("reads a month that has begun this year as this year's", () => {
    expect(extractDatePhrase("in March", at("UTC")).range).toMatchObject({
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    });
  });

  it("reads a month still ahead as last year's", () => {
    expect(extractDatePhrase("in December", at("UTC")).range).toMatchObject({
      from: "2025-12-01T00:00:00.000Z",
      to: "2026-01-01T00:00:00.000Z",
    });
  });

  it("reads a month with a year, and an abbreviation", () => {
    expect(
      extractDatePhrase("Sept 2025 offsite", at("UTC")).range,
    ).toMatchObject({
      from: "2025-09-01T00:00:00.000Z",
      to: "2025-10-01T00:00:00.000Z",
    });
    expect(extractDatePhrase("in Jan. 2026", at("UTC")).range?.from).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("reads a bare year and an ISO day", () => {
    expect(extractDatePhrase("hiring in 2025", at("UTC"))).toEqual({
      text: "hiring",
      range: {
        from: "2025-01-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
        phrase: "in 2025",
      },
    });
    expect(
      extractDatePhrase("on 2026-08-12", at("Asia/Kolkata")).range,
    ).toMatchObject({
      from: "2026-08-11T18:30:00.000Z",
      to: "2026-08-12T18:30:00.000Z",
    });
  });

  it("leaves 'may' alone unless it is clearly a month", () => {
    expect(extractDatePhrase("people I may call", at("UTC")).range).toBeNull();
    expect(extractDatePhrase("in May", at("UTC")).range?.from).toBe(
      "2026-05-01T00:00:00.000Z",
    );
    expect(extractDatePhrase("May 2025", at("UTC")).range?.from).toBe(
      "2025-05-01T00:00:00.000Z",
    );
  });

  it("does not read a month name inside another word", () => {
    expect(extractDatePhrase("marketing plan", at("UTC")).range).toBeNull();
    expect(extractDatePhrase("decade review", at("UTC")).range).toBeNull();
  });
});

describe("extractDatePhrase: anchored ranges", () => {
  it("reads 'since' as from the start of the anchor until now", () => {
    expect(extractDatePhrase("Berlin office since March", at("UTC"))).toEqual({
      text: "Berlin office",
      range: {
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-09-14T17:30:00.000Z",
        phrase: "since March",
      },
    });
    expect(extractDatePhrase("since last week", at("UTC")).range?.from).toBe(
      "2026-09-07T00:00:00.000Z",
    );
  });

  it("reads 'after' as from the end of the anchor", () => {
    expect(extractDatePhrase("after March", at("UTC")).range?.from).toBe(
      "2026-04-01T00:00:00.000Z",
    );
  });

  it("reads 'before' and 'until' as everything up to the anchor", () => {
    expect(
      extractDatePhrase("before 2026-08-01", at("UTC")).range,
    ).toMatchObject({
      from: "1970-01-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    });
    expect(extractDatePhrase("until last month", at("UTC")).range?.to).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("reads 'between' two anchors in either order", () => {
    const expected = {
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
    };
    expect(
      extractDatePhrase("between March and May", at("UTC")).range,
    ).toMatchObject(expected);
    expect(
      extractDatePhrase("from May to March", at("UTC")).range,
    ).toMatchObject(expected);
  });
});

describe("extractDatePhrase: nothing to read", () => {
  it("returns the query untouched when it names no period", () => {
    expect(extractDatePhrase("  hiring plans  ", at("UTC"))).toEqual({
      text: "hiring plans",
      range: null,
    });
  });

  it("lifts one phrase only, the most specific", () => {
    const out = extractDatePhrase("since March last year", at("UTC"));
    expect(out.range?.phrase).toBe("since March");
    expect(out.text).toBe("last year");
  });

  it("uses UTC when no zone is given", () => {
    expect(extractDatePhrase("last month", { now }).range?.from).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});

describe("boundFromFilter", () => {
  it("reads a calendar date as a whole day in the zone", () => {
    expect(boundFromFilter("2026-08-31", "from", "America/Los_Angeles")).toBe(
      "2026-08-31T07:00:00.000Z",
    );
    expect(boundFromFilter("2026-08-31", "to", "America/Los_Angeles")).toBe(
      "2026-09-01T07:00:00.000Z",
    );
  });

  it("takes an instant as it is", () => {
    expect(boundFromFilter("2026-08-31T10:00:00+02:00", "from", "UTC")).toBe(
      "2026-08-31T08:00:00.000Z",
    );
  });

  it("refuses what it cannot read", () => {
    expect(boundFromFilter("2026-13-01", "from", "UTC")).toBeNull();
    expect(boundFromFilter("yesterday", "from", "UTC")).toBeNull();
  });
});

describe("isValidTimeZone", () => {
  it("knows real zones and refuses invented ones", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
