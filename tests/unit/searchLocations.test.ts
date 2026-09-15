import { describe, expect, it } from "vitest";
import {
  extractQueryLocations,
  matchesQueryLocations,
} from "../../server/ai/searchLocations.ts";

const matches = (query: string, place: string, legacy: string[] = []) =>
  matchesQueryLocations(place, extractQueryLocations(query, legacy));

describe("structured search locations", () => {
  it.each([
    ["Engineers in London", "London, UK", "Cambridge, UK"],
    [
      "Researchers in Cambridge, MA",
      "Cambridge, Massachusetts, USA",
      "Cambridge, UK",
    ],
    ["Researchers in Cambridge, UK", "Cambridge, UK", "Cambridge, MA"],
    ["Contacts in San Francisco", "SF, California", "Los Angeles, California"],
    ["Contacts in Germany", "Berlin", "Paris, France"],
    ["Contacts in America", "Raleigh, NC", "Toronto, Canada"],
    ["Contacts in Ontario", "Toronto", "Vancouver, BC"],
    ["Contacts in London, Ontario", "London, ON", "London, UK"],
    ["Contacts in Tromso", "Tromsø, Norway", "Oslo, Norway"],
  ])("pairs %s against a near match", (query, valid, invalid) => {
    expect(matches(query, valid, ["Tromso"])).toBe(true);
    expect(matches(query, invalid, ["Tromso"])).toBe(false);
  });
  it.each([
    ["Contacts in Washington State", "Seattle, Washington", "Portland, Oregon"],
    ["Contacts in Scotland", "Edinburgh", "London, England"],
    ["Contacts in Lyon, France", "Lyon, France", "Paris, France"],
    ["Contacts in Washington, DC", "Washington, DC", "Seattle, WA"],
    ["Contacts in NYC", "New York, NY", "Buffalo, NY"],
  ])("keeps qualifiers for %s", (query, valid, invalid) => {
    expect(matches(query, valid)).toBe(true);
    expect(matches(query, invalid)).toBe(false);
  });
  it("does not turn industry and interests into places", () => {
    expect(extractQueryLocations("People in finance")).toEqual([]);
    expect(extractQueryLocations("People not in London", ["London"])).toEqual(
      [],
    );
    expect(
      extractQueryLocations("People in Boston and software engineers"),
    ).toEqual([{ city: "boston", sourcePhrase: "Boston" }]);
    expect(extractQueryLocations("People interested in AI")).toEqual([]);
    expect(extractQueryLocations("People from Sequoia")).toEqual([]);
  });
  it("keeps fallback city qualifiers together", () => {
    expect(
      matches("London UK engineers", "Cambridge, UK", ["London", "UK"]),
    ).toBe(false);
    expect(matches("London UK engineers", "London, UK", ["London", "UK"])).toBe(
      true,
    );
  });
  it("does not treat other New York cities as NYC", () => {
    expect(matches("Contacts in NYC", "Buffalo, New York")).toBe(false);
    expect(matches("Contacts in NYC", "Albany, New York, USA")).toBe(false);
    expect(matches("Contacts in NYC", "New York, New York, USA")).toBe(true);
  });
  it.each([
    "outside London",
    "except London",
    "excluding London",
    "not London",
    "anywhere but London",
  ])("does not turn %s into a positive fallback", (phrase) => {
    expect(
      extractQueryLocations(`Contacts ${phrase}`, ["London", "UK"]),
    ).toEqual([]);
  });
  it("preserves Unicode place names", () => {
    expect(matches("Contacts located in 東京", "東京, 日本")).toBe(true);
    expect(extractQueryLocations("東京 contacts", ["東京"])).toEqual([
      { literal: "東京", sourcePhrase: "東京" },
    ]);
    expect(matches("Contacts located in 東京", "London, UK")).toBe(false);
    expect(matches("Contacts in 東京", "London, UK", ["東京"])).toBe(false);
    expect(extractQueryLocations("Contacts located in !!!")).toEqual([]);
    expect(
      matchesQueryLocations("London", [{ sourcePhrase: "!!!", literal: "" }]),
    ).toBe(false);
  });
  it.each([
    [
      "Contacts in Washington State",
      "Seattle, WA, USA",
      "Washington, D.C., USA",
    ],
    [
      "Contacts in Washington, DC",
      "Washington, D.C., USA",
      "Seattle, Washington, U.S.A.",
    ],
    ["Contacts in Washington, D.C.", "Washington, DC, USA", "Seattle, WA, USA"],
    ["Contacts in New York State", "Buffalo, N.Y., U.S.A.", "Boston, MA, USA"],
    [
      "Contacts in California",
      "San Francisco, C.A., U.S.A.",
      "Seattle, WA, USA",
    ],
  ])("supports dotted codes in %s", (query, valid, invalid) => {
    expect(matches(query, valid)).toBe(true);
    expect(matches(query, invalid)).toBe(false);
  });
  it("separates Virginia from West Virginia", () => {
    expect(matches("Contacts in Virginia", "Richmond, Virginia, USA")).toBe(
      true,
    );
    expect(
      matches("Contacts in Virginia", "Charleston, West Virginia, USA"),
    ).toBe(false);
    expect(
      matches("Contacts in West Virginia", "Charleston, West Virginia, USA"),
    ).toBe(true);
  });
  it.each([
    "not currently in London",
    "excluding those in London",
    "who don't live in London",
  ])("does not invert %s", (phrase) => {
    expect(extractQueryLocations(`People ${phrase}`, ["London"])).toEqual([]);
  });
  it("keeps an explicit positive clause after a negative clause", () => {
    expect(
      extractQueryLocations("People not in London but in Boston", [
        "London",
        "Boston",
      ]),
    ).toEqual([{ city: "boston", sourcePhrase: "Boston" }]);
  });
  it.each([
    ["Contacts in London", "London, UK", "New London, Connecticut, USA"],
    [
      "Contacts in San Francisco",
      "San Francisco, CA",
      "South San Francisco, CA",
    ],
  ])("does not shorten compound city names for %s", (query, valid, invalid) => {
    expect(matches(query, valid)).toBe(true);
    expect(matches(query, invalid)).toBe(false);
  });
  it("does not widen a city to a planner country alias", () => {
    expect(
      matches("Engineers in London", "Cambridge, UK", [
        "London",
        "UK",
        "England",
      ]),
    ).toBe(false);
  });
  it("keeps an ambiguous city unqualified", () => {
    expect(extractQueryLocations("Researchers in Cambridge")).toEqual([
      { city: "cambridge", sourcePhrase: "Cambridge" },
    ]);
    expect(matches("Researchers in Cambridge", "Cambridge, UK")).toBe(true);
    expect(
      matches("Researchers in Cambridge", "Cambridge, Massachusetts"),
    ).toBe(true);
  });
  it("does not infer an ambiguous city's country without evidence", () => {
    expect(matches("Contacts in UK", "Cambridge")).toBe(false);
  });
  it("preserves explicit conflicting qualifiers", () => {
    expect(matches("Contacts in Cambridge, MA, UK", "Cambridge, MA, USA")).toBe(
      false,
    );
    expect(matches("Contacts in Cambridge, MA, UK", "Cambridge, UK")).toBe(
      false,
    );
  });
  it("accepts explicit alternatives without mixing qualifiers", () => {
    const query = "Contacts in Cambridge, UK or London, Ontario";
    expect(matches(query, "Cambridge, UK")).toBe(true);
    expect(matches(query, "London, Ontario")).toBe(true);
    expect(matches(query, "London, UK")).toBe(false);
    expect(matches(query, "Cambridge, MA")).toBe(false);
  });
  it("ignores ungrounded planner locations", () => {
    expect(extractQueryLocations("Find engineers", ["London"])).toEqual([]);
  });
  it("preserves exact source phrases", () => {
    expect(
      extractQueryLocations("Biotech contacts in Cambridge, UK with funding")[0]
        .sourcePhrase,
    ).toBe("Cambridge, UK");
  });
});
