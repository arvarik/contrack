import { describe, it, expect } from "vitest";
import {
  matchesFacet,
  unknownFacetValue,
  type FacetContact,
} from "../../../shared/searchFacets.ts";

describe("searchFacets matchesFacet", () => {
  describe("missing: facet", () => {
    it("matches missing company when null, empty or whitespace", () => {
      const contact1: FacetContact = { company: null };
      const contact2: FacetContact = { company: "" };
      const contact3: FacetContact = { company: "   " };
      const contact4: FacetContact = { company: "Acme Corp" };

      expect(
        matchesFacet(contact1, { field: "missing", value: "company" }),
      ).toBe(true);
      expect(
        matchesFacet(contact2, { field: "missing", value: "company" }),
      ).toBe(true);
      expect(
        matchesFacet(contact3, { field: "missing", value: "company" }),
      ).toBe(true);
      expect(
        matchesFacet(contact4, { field: "missing", value: "company" }),
      ).toBe(false);
    });

    it("matches missing location when null, empty or whitespace", () => {
      const contact1: FacetContact = { location: null };
      const contact2: FacetContact = { location: "" };
      const contact3: FacetContact = { location: "San Francisco" };

      expect(
        matchesFacet(contact1, { field: "missing", value: "location" }),
      ).toBe(true);
      expect(
        matchesFacet(contact2, { field: "missing", value: "location" }),
      ).toBe(true);
      expect(
        matchesFacet(contact3, { field: "missing", value: "location" }),
      ).toBe(false);
    });

    it("matches missing email when missing, empty array, or blank strings", () => {
      const contact1: FacetContact = {};
      const contact2: FacetContact = { emails: [] };
      const contact3: FacetContact = {
        emails: [{ email: "" }, { email: "   " }],
      };
      const contact4: FacetContact = {
        emails: [{ email: "test@example.com" }],
      };

      expect(matchesFacet(contact1, { field: "missing", value: "email" })).toBe(
        true,
      );
      expect(matchesFacet(contact2, { field: "missing", value: "email" })).toBe(
        true,
      );
      expect(matchesFacet(contact3, { field: "missing", value: "email" })).toBe(
        true,
      );
      expect(matchesFacet(contact4, { field: "missing", value: "email" })).toBe(
        false,
      );
    });

    it("matches missing phone when missing, empty array, or blank strings", () => {
      const contact1: FacetContact = {};
      const contact2: FacetContact = { phones: [] };
      const contact3: FacetContact = { phones: [{ phone: "" }] };
      const contact4: FacetContact = { phones: [{ phone: "+1-555-0100" }] };

      expect(matchesFacet(contact1, { field: "missing", value: "phone" })).toBe(
        true,
      );
      expect(matchesFacet(contact2, { field: "missing", value: "phone" })).toBe(
        true,
      );
      expect(matchesFacet(contact3, { field: "missing", value: "phone" })).toBe(
        true,
      );
      expect(matchesFacet(contact4, { field: "missing", value: "phone" })).toBe(
        false,
      );
    });

    it("returns false for unknown missing field", () => {
      const contact: FacetContact = { company: null };
      expect(
        matchesFacet(contact, { field: "missing", value: "unknownField" }),
      ).toBe(false);
    });
  });

  describe("standard facets", () => {
    const contact: FacetContact = {
      role: "Software Engineer",
      company: "Stripe",
      location: "London, UK",
      industry: "Fintech",
      tags: [{ tag: "Engineering" }, { tag: "Alumni" }],
      relationshipScore: 75,
    };

    it("matches role, company, location, and industry case-insensitively", () => {
      expect(matchesFacet(contact, { field: "role", value: "engineer" })).toBe(
        true,
      );
      expect(matchesFacet(contact, { field: "company", value: "STRIPE" })).toBe(
        true,
      );
      expect(
        matchesFacet(contact, { field: "location", value: "london" }),
      ).toBe(true);
      expect(
        matchesFacet(contact, { field: "industry", value: "fintech" }),
      ).toBe(true);
      expect(matchesFacet(contact, { field: "role", value: "designer" })).toBe(
        false,
      );
    });

    it("matches tags", () => {
      expect(matchesFacet(contact, { field: "tag", value: "alumni" })).toBe(
        true,
      );
      expect(matchesFacet(contact, { field: "tag", value: "founder" })).toBe(
        false,
      );
    });

    it("matches score operators on the score a card shows", () => {
      const scored: FacetContact = {
        ...contact,
        isTracked: true,
        lastContactedAt: "2026-09-01T10:00:00.000Z",
      };
      expect(
        matchesFacet(scored, { field: "score", value: "70", operator: ">" }),
      ).toBe(true);
      expect(
        matchesFacet(scored, { field: "score", value: "80", operator: ">" }),
      ).toBe(false);
      expect(
        matchesFacet(scored, { field: "score", value: "80", operator: "<" }),
      ).toBe(true);
      expect(
        matchesFacet(scored, { field: "score", value: "70", operator: "<" }),
      ).toBe(false);
      // "Not tracked" and "No interactions yet" show no score to match.
      for (const shown of [contact, { ...scored, lastContactedAt: null }])
        expect(
          matchesFacet(shown, { field: "score", value: "70", operator: ">" }),
        ).toBe(false);
    });
  });

  describe("list: facet", () => {
    const contact: FacetContact = {
      lists: [
        { id: "list-1", name: "Advisors" },
        { id: "list-2", name: "Board Members" },
      ],
    };

    it("matches list by exact name case-insensitively", () => {
      expect(matchesFacet(contact, { field: "list", value: "advisors" })).toBe(
        true,
      );
      expect(matchesFacet(contact, { field: "list", value: "ADVISORS" })).toBe(
        true,
      );
      expect(
        matchesFacet(contact, { field: "list", value: "Board Members" }),
      ).toBe(true);
      expect(matchesFacet(contact, { field: "list", value: "Investors" })).toBe(
        false,
      );
    });

    it("matches list by id", () => {
      expect(matchesFacet(contact, { field: "list", value: "list-1" })).toBe(
        true,
      );
      expect(matchesFacet(contact, { field: "list", value: "list-2" })).toBe(
        true,
      );
      expect(matchesFacet(contact, { field: "list", value: "list-999" })).toBe(
        false,
      );
    });

    it("matches hyphenated list name form", () => {
      expect(
        matchesFacet(contact, { field: "list", value: "board-members" }),
      ).toBe(true);
    });

    it("returns false if contact has no lists", () => {
      expect(
        matchesFacet({ lists: [] }, { field: "list", value: "advisors" }),
      ).toBe(false);
      expect(matchesFacet({}, { field: "list", value: "advisors" })).toBe(
        false,
      );
    });
  });

  describe("near: facet", () => {
    // London: 51.5074, -0.1278
    // Oxford: 51.7520, -1.2577 (~83 km from London)
    // Paris: 48.8566, 2.3522 (~344 km from London)
    const londonContact: FacetContact = { lat: 51.5074, lng: -0.1278 };
    const oxfordContact: FacetContact = { lat: 51.752, lng: -1.2577 };
    const noCoordContact: FacetContact = { lat: null, lng: null };

    it("matches all contacts when point is not resolved yet (resolving state)", () => {
      expect(
        matchesFacet(londonContact, { field: "near", value: "London" }),
      ).toBe(true);
      expect(
        matchesFacet(oxfordContact, { field: "near", value: "London" }),
      ).toBe(true);
      expect(
        matchesFacet(noCoordContact, { field: "near", value: "London" }),
      ).toBe(true);
    });

    it("filters contacts within distance when point is resolved", () => {
      const londonCenter = { lat: 51.5074, lng: -0.1278 };

      // 50 km radius: London is inside, Oxford (~83 km) is outside
      const filter50km = {
        field: "near" as const,
        value: "London",
        km: 50,
        point: { ...londonCenter, km: 50 },
      };

      expect(matchesFacet(londonContact, filter50km)).toBe(true);
      expect(matchesFacet(oxfordContact, filter50km)).toBe(false);
      expect(matchesFacet(noCoordContact, filter50km)).toBe(false);

      // 100 km radius: both London and Oxford are inside
      const filter100km = {
        field: "near" as const,
        value: "London",
        km: 100,
        point: { ...londonCenter, km: 100 },
      };

      expect(matchesFacet(londonContact, filter100km)).toBe(true);
      expect(matchesFacet(oxfordContact, filter100km)).toBe(true);
    });
  });

  describe("tracked: facet", () => {
    const tracked: FacetContact = { isTracked: true };
    const untracked: FacetContact = { isTracked: false };
    const unknown: FacetContact = {};

    it("tracked:yes matches the people a person keeps up with", () => {
      const filter = { field: "tracked" as const, value: "yes" };
      expect(matchesFacet(tracked, filter)).toBe(true);
      expect(matchesFacet(untracked, filter)).toBe(false);
      expect(matchesFacet(unknown, filter)).toBe(false);
    });

    it("tracked:no matches everyone else", () => {
      const filter = { field: "tracked" as const, value: "no" };
      expect(matchesFacet(tracked, filter)).toBe(false);
      expect(matchesFacet(untracked, filter)).toBe(true);
      expect(matchesFacet(unknown, filter)).toBe(true);
    });

    it("any other value matches nobody", () => {
      const filter = { field: "tracked" as const, value: "maybe" };
      expect(matchesFacet(tracked, filter)).toBe(false);
      expect(matchesFacet(untracked, filter)).toBe(false);
    });
  });

  // `contacted:` reads the last contact: more than N ago or never, within N,
  // or never. A date that cannot be read counts as never.
  describe("contacted: facet", () => {
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const recent: FacetContact = { lastContactedAt: daysAgo(5) };
    const lapsed: FacetContact = { lastContactedAt: daysAgo(120) };
    // SQLite's own form is UTC with a space and no zone.
    const lapsedSqlite: FacetContact = {
      lastContactedAt: daysAgo(120).replace("T", " ").slice(0, 19),
    };
    const never: FacetContact = { lastContactedAt: null };
    const unreadable: FacetContact = { lastContactedAt: "someday" };

    it("contacted:>90d is more than 90 days ago, or never", () => {
      const filter = {
        field: "contacted" as const,
        value: "90d",
        operator: ">" as const,
      };
      expect(matchesFacet(lapsed, filter)).toBe(true);
      expect(matchesFacet(lapsedSqlite, filter)).toBe(true);
      expect(matchesFacet(never, filter)).toBe(true);
      expect(matchesFacet(unreadable, filter)).toBe(true);
      expect(matchesFacet(recent, filter)).toBe(false);
    });

    it("contacted:<30d is within the last 30 days", () => {
      const filter = {
        field: "contacted" as const,
        value: "30d",
        operator: "<" as const,
      };
      expect(matchesFacet(recent, filter)).toBe(true);
      expect(matchesFacet(lapsed, filter)).toBe(false);
      expect(matchesFacet(never, filter)).toBe(false);
    });

    it("contacted:never is never", () => {
      const filter = { field: "contacted" as const, value: "never" };
      expect(matchesFacet(never, filter)).toBe(true);
      expect(matchesFacet(unreadable, filter)).toBe(true);
      expect(matchesFacet(recent, filter)).toBe(false);
    });

    it("a value that is not a duration matches nobody", () => {
      const filter = { field: "contacted" as const, value: "lately" };
      expect(matchesFacet(never, filter)).toBe(false);
      expect(matchesFacet(recent, filter)).toBe(false);
    });
  });
});

describe("unknownFacetValue", () => {
  it("names the values a facet takes, only for a value it does not know", () => {
    expect(unknownFacetValue({ field: "tracked", value: "maybe" })).toBe(
      "yes or no",
    );
    expect(unknownFacetValue({ field: "tracked", value: "Yes" })).toBeNull();
    expect(
      unknownFacetValue({ field: "contacted", value: "never" }),
    ).toBeNull();
    expect(unknownFacetValue({ field: "updated", value: "soon" })).toBe(
      "a time, such as >3m",
    );
    // A text facet takes any text.
    expect(unknownFacetValue({ field: "company", value: "zz" })).toBeNull();
  });
});
