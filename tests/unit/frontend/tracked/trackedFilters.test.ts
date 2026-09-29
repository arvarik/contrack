// =============================================================================
// The Tracked contacts page's filters, as rules
// =============================================================================
// Two rows of pills (tracking, and when you last spoke) and an order, kept
// in the page's address. The address rules, each row's rule, and the edges
// of "Past month" and "Past year" are pinned here.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRACKED_VIEW,
  lastSpokeAt,
  matchesSpokeFilter,
  matchesTrackingFilter,
  paramsWithTrackedView,
  trackedViewFromParams,
} from "../../../../src/lib/trackedFilters";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const DAY = 86_400_000;
const spokeDaysAgo = (days: number) => ({
  isTracked: false,
  lastContactedAt: new Date(NOW - days * DAY).toISOString(),
});

describe("trackedViewFromParams", () => {
  it("reads the three choices from the address", () => {
    expect(
      trackedViewFromParams(
        new URLSearchParams("tracking=not_tracked&spoke=month&order=spoke"),
      ),
    ).toEqual({ tracking: "not_tracked", spoke: "month", order: "spoke" });
  });

  it("takes each row's first choice for a missing or unknown value", () => {
    expect(trackedViewFromParams(new URLSearchParams(""))).toEqual(
      DEFAULT_TRACKED_VIEW,
    );
    expect(
      trackedViewFromParams(
        new URLSearchParams("tracking=everyone&spoke=soon&order=score"),
      ),
    ).toEqual(DEFAULT_TRACKED_VIEW);
  });
});

describe("paramsWithTrackedView", () => {
  it("writes the choices, leaves a first choice out, and keeps other parameters", () => {
    const next = paramsWithTrackedView(new URLSearchParams("q=ada"), {
      tracking: "tracked",
      spoke: "year",
      order: "recent",
    });
    expect(next.toString()).toBe(
      "q=ada&tracking=tracked&spoke=year&order=recent",
    );
    const back = paramsWithTrackedView(next, {
      tracking: "all",
      spoke: "any",
      order: "name",
    });
    expect(back.toString()).toBe("q=ada");
  });

  it("changes only the choices it is given", () => {
    const next = paramsWithTrackedView(
      new URLSearchParams("tracking=tracked&order=spoke"),
      { spoke: "never" },
    );
    expect(trackedViewFromParams(next)).toEqual({
      tracking: "tracked",
      spoke: "never",
      order: "spoke",
    });
  });
});

describe("matchesTrackingFilter", () => {
  it("shows everyone, the tracked people, or the rest", () => {
    const tracked = { isTracked: true, lastContactedAt: null };
    const untracked = { isTracked: false, lastContactedAt: null };
    expect(matchesTrackingFilter(tracked, "all")).toBe(true);
    expect(matchesTrackingFilter(untracked, "all")).toBe(true);
    expect(matchesTrackingFilter(tracked, "tracked")).toBe(true);
    expect(matchesTrackingFilter(untracked, "tracked")).toBe(false);
    expect(matchesTrackingFilter(tracked, "not_tracked")).toBe(false);
    expect(matchesTrackingFilter(untracked, "not_tracked")).toBe(true);
  });
});

describe("matchesSpokeFilter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("puts the last 30 days in Past month, and day 31 out of it", () => {
    expect(matchesSpokeFilter(spokeDaysAgo(0), "month", NOW)).toBe(true);
    expect(matchesSpokeFilter(spokeDaysAgo(30), "month", NOW)).toBe(true);
    expect(matchesSpokeFilter(spokeDaysAgo(31), "month", NOW)).toBe(false);
  });

  it("puts the last 365 days in Past year, and anything older in Over a year ago", () => {
    expect(matchesSpokeFilter(spokeDaysAgo(3), "year", NOW)).toBe(true);
    expect(matchesSpokeFilter(spokeDaysAgo(365), "year", NOW)).toBe(true);
    expect(matchesSpokeFilter(spokeDaysAgo(365), "older", NOW)).toBe(false);
    expect(matchesSpokeFilter(spokeDaysAgo(366), "year", NOW)).toBe(false);
    expect(matchesSpokeFilter(spokeDaysAgo(366), "older", NOW)).toBe(true);
  });

  it("puts a contact with no interaction in Never, and in no time window", () => {
    const never = { isTracked: false, lastContactedAt: null };
    expect(matchesSpokeFilter(never, "never", NOW)).toBe(true);
    expect(matchesSpokeFilter(never, "any", NOW)).toBe(true);
    for (const filter of ["month", "year", "older"] as const) {
      expect(matchesSpokeFilter(never, filter, NOW)).toBe(false);
    }
    expect(matchesSpokeFilter(spokeDaysAgo(2), "never", NOW)).toBe(false);
  });

  it("reads the server's space-separated UTC form too", () => {
    // In UTC the form read as local time is the same instant, so the check
    // could not fail in CI. Los Angeles is seven hours behind.
    vi.stubEnv("TZ", "America/Los_Angeles");
    const contact = { lastContactedAt: "2026-09-20 08:00:00" };
    expect(lastSpokeAt(contact)).toBe(Date.parse("2026-09-20T08:00:00Z"));
    expect(
      matchesSpokeFilter({ ...contact, isTracked: true }, "month", NOW),
    ).toBe(true);
  });
});
