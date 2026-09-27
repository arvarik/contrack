// =============================================================================
// Integration: keyword search among 5,000 contacts
// =============================================================================
// The forms of a name people type: a nickname and a surname, a phone number
// as bare digits, a hyphenated name with or without its hyphens, the first
// letters of a rare name, and a misspelling. Each finds its contact among
// 5,000, with decoys built to defeat the old candidate step: hundreds of
// names that share the first two letters, and people who share one word of
// a misspelled name.
// =============================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { searchService } from "../../server/services/searchService.ts";
import { lexicalSearch } from "../../server/services/search/lexical.ts";

const scope = () => scopeForOwnerId(ensureLocalOwner());

type Seed = {
  name: string;
  company?: string;
  role?: string;
  about?: string;
  emails?: string[];
  phones?: string[];
};

const TARGETS: Seed[] = [
  { name: "Margaret Ellington", company: "Crestwood Capital" },
  { name: "Robert Castellanos", role: "Fleet Manager" },
  { name: "Anne-Marie Dubois-Laurent", company: "Maison Vireo" },
  { name: "Xiomara Reyes", role: "Climbing Coach" },
  { name: "Krzysztof Nowak", company: "Baltic Freight Union" },
  { name: "Siobhan Murphy", company: "Kestrel Analytics" },
  { name: "Jonathan Smith", company: "Northwind Logistics" },
  { name: "Marcus Delgado", phones: ["+1 (415) 555-0142"] },
  { name: "Harriet Vance", phones: ["+44 161 496 0321"] },
  { name: "Orla Keane", phones: ["+353 1 555 0147"] },
  { name: "Priya Raghunathan", phones: ["(415) 555-0123"] },
  // Written the way an escaping export writes it.
  { name: "Lupe Auer", phones: ["\\+1 \\(771\\) 804-3400"] },
];

/**
 * Decoys. Three hundred names that start with the first two letters of
 * "Kristof" and "Novak" but not the third, a real Peggy, and people who
 * carry one word of "Jonathon Smyth" in another column.
 */
function decoys(): Seed[] {
  const out: Seed[] = [];
  for (let i = 0; i < 150; i++)
    out.push({ name: `Kr${faker.person.firstName().toLowerCase()} Stone` });
  for (let i = 0; i < 150; i++)
    out.push({ name: `Ada No${faker.person.lastName().toLowerCase()}` });
  out.push({ name: "Peggy Torp" }, { name: "Walter Ellington" });
  // Two Margarets and two people who go by her nicknames.
  out.push(
    { name: "Margaret Quinn" },
    { name: "Margaret Oduya" },
    { name: "Maggie Holt" },
    { name: "Margie Lund" },
  );
  for (let i = 0; i < 40; i++)
    out.push({
      name: faker.person.fullName(),
      company: i % 2 ? "Smyth & Partners" : "Jonathon Road Studios",
    });
  return out;
}

beforeAll(async () => {
  faker.seed(20_260_927);
  const generated: Seed[] = Array.from(
    { length: 5_000 - TARGETS.length - 346 },
    () => ({
      name: faker.person.fullName(),
      company: faker.company.name(),
      role: faker.person.jobTitle(),
    }),
  );
  const all = [...TARGETS, ...decoys(), ...generated];
  expect(all).toHaveLength(5_000);
  for (let i = 0; i < all.length; i += 500)
    await contactService.bulkCreateContacts(scope(), all.slice(i, i + 500));
}, 120_000);

/** The names the sidebar shows, in order. */
const sidebar = (query: string) =>
  searchService.searchFts(scope(), query).map((row) => row.name);

describe("keyword search finds the forms of a name among 5,000 contacts", () => {
  it("finds Margaret from her nickname and surname, above a real Peggy", () => {
    const names = sidebar("Peggy Ellington");
    expect(names[0]).toBe("Margaret Ellington");
    expect(names.indexOf("Peggy Torp")).not.toBe(0);
  });

  it("lists everyone named Margaret before the people her nicknames find", () => {
    const names = sidebar("Margaret");
    const lastMargaret = Math.max(
      ...names.flatMap((name, i) => (name.startsWith("Margaret") ? [i] : [])),
    );
    const firstNickname = names.findIndex((name) =>
      /^(Maggie|Margie|Peggy|Marge|Meg) /.test(name),
    );
    expect(names).toEqual(
      expect.arrayContaining(["Margaret Quinn", "Margaret Oduya"]),
    );
    expect(firstNickname).toBeGreaterThan(lastMargaret);
  });

  it("finds Robert from Bob and his surname", () => {
    expect(sidebar("Bob Castellanos")[0]).toBe("Robert Castellanos");
  });

  it.each([
    ["the digits without the country code", "4155550142", "Marcus Delgado"],
    ["a trunk zero", "01614960321", "Harriet Vance"],
    ["the local number", "5550147", "Orla Keane"],
    [
      "a country code the number was stored without",
      "14155550123",
      "Priya Raghunathan",
    ],
    ["the number as written", "+1 (415) 555-0142", "Marcus Delgado"],
    ["the digits of a number an export escaped", "7718043400", "Lupe Auer"],
  ])("finds a phone number typed as %s", (_how, query, name) => {
    expect(sidebar(query)).toEqual([name]);
  });

  it.each([
    ["with its hyphens", "Anne-Marie Dubois-Laurent"],
    ["as the surname alone", "Dubois-Laurent"],
    ["with spaces", "Anne Marie Dubois Laurent"],
    ["run together", "Annemarie Dubois"],
  ])("finds a hyphenated name typed %s", (_how, query) => {
    expect(sidebar(query)[0]).toBe("Anne-Marie Dubois-Laurent");
  });

  it.each([
    ["Xiom", "Xiomara Reyes"],
    ["Krzy", "Krzysztof Nowak"],
    ["Siob", "Siobhan Murphy"],
  ])("finds %s by its first letters", (query, name) => {
    expect(sidebar(query)[0]).toBe(name);
  });

  it("finds a misspelled name behind 300 names that share its first two letters", () => {
    // "Kristof Novak" shares only "kr" and "no" with Krzysztof Nowak. Each
    // prefix alone matches 150 decoys, so an unordered cut of the
    // candidates could drop him. BM25 puts the name that shares both first.
    expect(sidebar("Kristof Novak")[0]).toBe("Krzysztof Nowak");
    const broad = lexicalSearch(scope(), "Kristof Novak", 100, null, true);
    const nowak = searchService.searchFts(scope(), "Krzysztof Nowak")[0].id;
    expect(broad[0].contactId).toBe(nowak);
  });

  it("ranks a close misspelling above people who share one word of it", () => {
    // Forty people carry "Jonathon" or "Smyth" in their company, so each is
    // a partial match. Jonathan Smith matches no word as typed, but his name
    // scores 0.94, which ranks above partial matches. It used to rank below
    // every one of them.
    const broad = lexicalSearch(scope(), "Jonathon Smyth", 100, null, true);
    const smith = searchService.searchFts(scope(), "Jonathan Smith")[0].id;
    expect(broad[0].contactId).toBe(smith);
    expect(broad.length).toBeGreaterThan(40);
    expect(broad[0]).toMatchObject({ approximate: true });
  });

  it("answers a phone number locally and verified, with no model", async () => {
    const result = await searchService.semanticSearch(
      scope(),
      "4155550142",
      "lexical-phone",
      undefined,
      { aiAllowed: false },
    );
    expect(result.fallback).toBe(false);
    expect(result.matches.map((m) => [m.name, m.verified])).toEqual([
      ["Marcus Delgado", true],
    ]);
  });
});
