import { describe, it, expect } from "vitest";
import { parseFacetQuery, parseFilterValue } from "../../shared/facetQuery.ts";

// The facet parser moved out of the palette's tokenizer hook so the server
// can read facets typed into Ask. These cases moved with it unchanged.

describe("parseFilterValue", () => {
  it("parses near:London/50km to km: 50", () => {
    const filter = parseFilterValue("near", "London/50km");
    expect(filter).toEqual({
      field: "near",
      value: "London",
      km: 50,
    });
  });

  it("parses near:London/50 without explicit km suffix to km: 50", () => {
    const filter = parseFilterValue("near", "London/50");
    expect(filter).toEqual({
      field: "near",
      value: "London",
      km: 50,
    });
  });

  it("defaults near:Paris to 25 km", () => {
    const filter = parseFilterValue("near", "Paris");
    expect(filter).toEqual({
      field: "near",
      value: "Paris",
      km: 25,
    });
  });

  // Note: Free-text tokenizer uses whitespace boundary for pills,
  // so multi-word list names use the hyphen form (e.g. list:advisors-board)
  // or are selected via autocomplete.
  it.each(["investors", "advisors-board"])(
    "parses list facet values directly: %s",
    (value) => {
      expect(parseFilterValue("list", value)).toEqual({ field: "list", value });
    },
  );
});

describe("parseFilterValue for contacted:", () => {
  it("reads an operator and a duration", () => {
    expect(parseFilterValue("contacted", ">90d")).toEqual({
      field: "contacted",
      value: "90d",
      operator: ">",
    });
    expect(parseFilterValue("contacted", "<30d")).toEqual({
      field: "contacted",
      value: "30d",
      operator: "<",
    });
  });

  it("defaults the operator to more than, like updated:", () => {
    expect(parseFilterValue("contacted", "6m")).toEqual({
      field: "contacted",
      value: "6m",
      operator: ">",
    });
  });

  it("reads never in any case", () => {
    expect(parseFilterValue("contacted", "Never")).toEqual({
      field: "contacted",
      value: "never",
    });
  });

  it("rejects anything else", () => {
    expect(parseFilterValue("contacted", "soon")).toBeNull();
    expect(parseFilterValue("contacted", ">90")).toBeNull();
  });
});

describe("parseFacetQuery", () => {
  it("splits facets from the free text, a trailing facet included", () => {
    expect(parseFacetQuery("tag:investor who climbs list:core")).toEqual({
      freeText: "who climbs",
      filters: [
        { field: "tag", value: "investor" },
        { field: "list", value: "core" },
      ],
    });
  });

  it("reads contacted: and keeps a value the parser rejects as text", () => {
    expect(parseFacetQuery("contacted:>90d score:abc")).toEqual({
      freeText: "score:abc",
      filters: [{ field: "contacted", value: "90d", operator: ">" }],
    });
  });

  it("keeps a word with an unknown field as text", () => {
    expect(parseFacetQuery("note:hello Ada")).toEqual({
      freeText: "note:hello Ada",
      filters: [],
    });
  });

  it("drops a repeated facet", () => {
    expect(parseFacetQuery("tag:a tag:a").filters).toEqual([
      { field: "tag", value: "a" },
    ]);
  });
});
