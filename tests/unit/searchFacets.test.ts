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
});
