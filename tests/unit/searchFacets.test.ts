import { describe, it, expect } from "vitest";
import { matchesFacet, type FacetContact } from "../../shared/searchFacets.ts";

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

    it("matches score operators", () => {
      expect(
        matchesFacet(contact, { field: "score", value: "70", operator: ">" }),
      ).toBe(true);
      expect(
        matchesFacet(contact, { field: "score", value: "80", operator: ">" }),
      ).toBe(false);
      expect(
        matchesFacet(contact, { field: "score", value: "80", operator: "<" }),
      ).toBe(true);
      expect(
        matchesFacet(contact, { field: "score", value: "70", operator: "<" }),
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
});
