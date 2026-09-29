// =============================================================================
// Unit: the Enrichment page's two rows of filters
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  filtersFromParams,
  matchesContactFilter,
  matchesResearchFilter,
  paramsWithFilters,
  type FilteredContact,
} from "../../../../src/lib/enrichmentFilters";

const NOW = Date.parse("2026-09-27T00:00:00.000Z");

const contact = (fields: Partial<FilteredContact> = {}): FilteredContact => ({
  isTracked: false,
  emails: [],
  socialLinks: [],
  socialLinkCount: 0,
  aiHydratedAt: null,
  researchOutcome: null,
  ...fields,
});

describe("the Contacts row", () => {
  it("shows the tracked, the linked, the reachable, and those with neither", () => {
    const tracked = contact({ isTracked: true });
    const linked = contact({ socialLinkCount: 2 });
    const emailed = contact({
      emails: [{ email: "rv@example.com" }] as FilteredContact["emails"],
    });
    const bare = contact();
    expect(matchesContactFilter(tracked, "tracked")).toBe(true);
    expect(matchesContactFilter(bare, "tracked")).toBe(false);
    expect(matchesContactFilter(linked, "has_links")).toBe(true);
    expect(matchesContactFilter(emailed, "has_email")).toBe(true);
    expect(matchesContactFilter(bare, "no_data")).toBe(true);
    expect(matchesContactFilter(linked, "no_data")).toBe(false);
    for (const each of [tracked, linked, emailed, bare])
      expect(matchesContactFilter(each, "all")).toBe(true);
  });
});

describe("the Research row", () => {
  it("tells never researched, researched six months ago, and found nothing apart", () => {
    const never = contact();
    const recent = contact({
      aiHydratedAt: new Date(NOW - 30 * 864e5).toISOString(),
      researchOutcome: "added",
    });
    // Six months is 183 days: research 184 days old is due again, and
    // research 182 days old is not.
    const old = contact({
      aiHydratedAt: new Date(NOW - 184 * 864e5).toISOString(),
      researchOutcome: "added",
    });
    const nearlyOld = contact({
      aiHydratedAt: new Date(NOW - 182 * 864e5).toISOString(),
      researchOutcome: "added",
    });
    const nothing = contact({
      aiHydratedAt: new Date(NOW - 864e5).toISOString(),
      researchOutcome: "no-public-info",
    });
    expect(matchesResearchFilter(never, "not_yet", NOW)).toBe(true);
    expect(matchesResearchFilter(recent, "not_yet", NOW)).toBe(false);
    expect(matchesResearchFilter(old, "stale", NOW)).toBe(true);
    expect(matchesResearchFilter(nearlyOld, "stale", NOW)).toBe(false);
    expect(matchesResearchFilter(recent, "stale", NOW)).toBe(false);
    // Never researched is not old research.
    expect(matchesResearchFilter(never, "stale", NOW)).toBe(false);
    expect(matchesResearchFilter(nothing, "found_nothing", NOW)).toBe(true);
    expect(matchesResearchFilter(recent, "found_nothing", NOW)).toBe(false);
    for (const each of [never, recent, old, nothing])
      expect(matchesResearchFilter(each, "any", NOW)).toBe(true);
  });
});

describe("the filters in the page address", () => {
  it("reads both rows, and a missing or unknown value as the first choice", () => {
    expect(
      filtersFromParams(
        new URLSearchParams("contacts=tracked&research=found_nothing"),
      ),
    ).toEqual({ contacts: "tracked", research: "found_nothing" });
    expect(filtersFromParams(new URLSearchParams(""))).toEqual({
      contacts: "all",
      research: "any",
    });
    expect(
      filtersFromParams(new URLSearchParams("contacts=everyone&research=1")),
    ).toEqual({ contacts: "all", research: "any" });
  });

  it("writes a choice, leaves out a first choice, and keeps other parameters", () => {
    const start = new URLSearchParams("tab=list&contacts=tracked");
    expect(paramsWithFilters(start, { research: "stale" }).toString()).toBe(
      "tab=list&contacts=tracked&research=stale",
    );
    expect(
      paramsWithFilters(start, { contacts: "all", research: "any" }).toString(),
    ).toBe("tab=list");
    // The parameters it was given are not changed.
    expect(start.toString()).toBe("tab=list&contacts=tracked");
  });
});
