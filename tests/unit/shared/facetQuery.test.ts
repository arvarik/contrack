import { describe, it, expect } from "vitest";
import {
  formatFacetQuery,
  parseFacetQuery,
  parseFilterValue,
} from "../../../shared/facetQuery.ts";

// The facet parser moved out of the palette's tokenizer hook so the server
// can read facets typed into Ask. These cases moved with it unchanged.

describe("parseFilterValue", () => {
  it.each([
    // An explicit km suffix, no suffix, and no radius at all.
    ["London/50km", "London", 50],
    ["London/50", "London", 50],
    ["Paris", "Paris", 25],
  ])("parses near:%s as %s within %i km", (raw, value, km) => {
    expect(parseFilterValue("near", raw)).toEqual({ field: "near", value, km });
  });

  it("removes one pair of double quotes, so the pill reads the words", () => {
    expect(parseFilterValue("industry", '"Venture Capital"')).toEqual({
      field: "industry",
      value: "Venture Capital",
    });
  });

  it("reads a quoted place with a distance after it", () => {
    expect(parseFilterValue("near", '"San Francisco"/50km')).toEqual({
      field: "near",
      value: "San Francisco",
      km: 50,
    });
  });

  it("rejects an empty pair of quotes", () => {
    expect(parseFilterValue("industry", '""')).toBeNull();
  });

  // A multi-word list name works in quotes, list:"Advisory board", and the
  // hyphen form still works for a name typed without them.
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

  it("reads a quoted value with a space as one facet", () => {
    expect(parseFacetQuery('industry:"Venture Capital" in London')).toEqual({
      freeText: "in London",
      filters: [{ field: "industry", value: "Venture Capital" }],
    });
  });

  it("keeps the quotes of free text as they were typed", () => {
    expect(parseFacetQuery('"exact phrase" tag:vc note:"a b"')).toEqual({
      freeText: '"exact phrase" note:"a b"',
      filters: [{ field: "tag", value: "vc" }],
    });
  });

  it("drops a repeated facet", () => {
    expect(parseFacetQuery("tag:a tag:a").filters).toEqual([
      { field: "tag", value: "a" },
    ]);
  });
});

describe("formatFacetQuery", () => {
  it("writes filters that parseFacetQuery reads back to the same filters", () => {
    const query =
      'industry:"Venture Capital" contacted:>90d contacted:never score:<40 ' +
      'tracked:yes missing:email near:"San Francisco"/50km tag:investor';
    const { filters } = parseFacetQuery(query);
    expect(formatFacetQuery(filters)).toBe(query);
    expect(parseFacetQuery(formatFacetQuery(filters))).toEqual({
      freeText: "",
      filters,
    });
  });
});
