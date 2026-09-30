// =============================================================================
// Integration: the pool of starter questions behind "Try asking" on Ask
// =============================================================================
// The pool is built from the account's own contacts. Every question names a
// value two people share (one is enough in a network under ten), in words
// the search answers with no model, so a press always finds the people the
// question was built from. The pool is kept per search revision: a few edits
// serve the old pool while a new one builds, and a bulk change builds before
// it answers.
//
// The real database and search pipeline run here. Integration tests run in
// mock mode, so Ask answers without a model, which is the path that must
// find these people on its own.
// =============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { searchService } from "../../server/services/searchService.ts";
import {
  POOL_LIMIT,
  article,
  buildStarterQuestions,
  resetStarterQuestions,
  scheduleStarterQuestions,
  starterQuestions,
  warmStarterQuestions,
} from "../../server/services/search/starterQuestions.ts";
import type { NewContactPayload } from "../../server/repositories/types.ts";
import type { StarterQuestion } from "../../shared/starterQuestions.ts";
import { GENERAL_QUESTIONS } from "../../shared/generalQuestions.ts";
import { findImplicitFacets } from "../../server/services/search/implicitFacets.ts";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

/** Twelve people: from ten on, a value must be shared by two. */
const NETWORK: NewContactPayload[] = [
  {
    name: "Ana Costa",
    industry: "Fintech",
    location: "Lisbon, Portugal",
    company: "Northwind Logistics",
    role: "Product Designer",
    interests: ["Rock Climbing", "Espresso"],
    tags: ["investor", "everyone"],
  },
  {
    name: "Rui Alves",
    industry: "Fintech",
    location: "Lisbon, Portugal",
    company: "northwind logistics",
    role: "Product Designer",
    interests: ["Rock Climbing", "Lisbon"],
    tags: ["investor", "everyone"],
  },
  {
    name: "Mia Chen",
    industry: "fintech",
    location: "Austin, TX",
    role: "CTO",
    interests: ["Lisbon"],
    tags: ["everyone"],
  },
  {
    name: "Leo Park",
    industry: "Climate Tech",
    location: "Austin, TX",
    role: "CTO",
    tags: ["everyone"],
  },
  {
    name: "Iris Novak",
    industry: "Climate Tech",
    location: "Lisbon, Portugal",
    role: "Engineer at Google",
    tags: ["everyone"],
  },
  {
    name: "Tom Reed",
    industry: "Media",
    location: "Paris, Texas",
    role: "Engineer at Google",
    tags: ["everyone"],
  },
  ...["Kai", "Lea", "Max", "Noa", "Oli", "Pia"].map((first) => ({
    name: `${first} Filler`,
    tags: ["everyone"],
  })),
];

async function seed(people: NewContactPayload[]) {
  sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(localOwnerId());
  resetStarterQuestions();
  // The service takes the payloads as they are, so each run gets copies.
  await contactService.bulkCreateContacts(
    scope(),
    people.map((person) => ({ ...person })),
  );
}

const texts = (pool: StarterQuestion[]) => pool.map((q) => q.text);

describe("the starter question pool", () => {
  beforeEach(() => seed(NETWORK));

  it("asks about the values two people share, each kind in turn", () => {
    // The general questions have their own tests below.
    const pool = buildStarterQuestions(scope()).filter(
      (q) => q.kind !== "general",
    );
    expect(pool).toEqual([
      { kind: "industry", text: "Who works in Fintech?" },
      { kind: "city", text: "Who do I know in Lisbon?" },
      { kind: "company", text: "Who works at Northwind Logistics?" },
      { kind: "interest", text: "Who is interested in Rock Climbing?" },
      { kind: "role", text: "Who works as a CTO?" },
      { kind: "pair", text: "Who works in Fintech in Lisbon?" },
      { kind: "tag", text: "Who is tagged investor?" },
      { kind: "industry", text: "Who works in Climate Tech?" },
      { kind: "city", text: "Who do I know in Austin?" },
      { kind: "role", text: "Who works as a Product Designer?" },
    ]);
  });

  it("lets a general question take its turn after every kind built from the network's values", () => {
    const pool = buildStarterQuestions(scope());
    expect(pool.slice(0, 8).map((q) => q.kind)).toEqual([
      "industry",
      "city",
      "company",
      "interest",
      "role",
      "pair",
      "tag",
      "general",
    ]);
  });

  it("leaves out what would not find its people", () => {
    const pool = texts(buildStarterQuestions(scope()));
    // Held by one person in a network of twelve.
    expect(pool).not.toContain("Who works in Media?");
    expect(pool).not.toContain("Who is interested in Espresso?");
    expect(pool.join()).not.toContain("Paris");
    // "interested in Lisbon" would be read as a place facet.
    expect(pool).not.toContain("Who is interested in Lisbon?");
    // A job and its employer, not a role.
    expect(pool.join()).not.toContain("Google");
    // A tag on everyone says nothing about anyone.
    expect(pool).not.toContain("Who is tagged everyone?");
  });

  it("never holds more questions than contacts, or than its limit", async () => {
    await seed(NETWORK.slice(0, 3));
    const small = buildStarterQuestions(scope());
    // Under ten people one holder is enough, so there is more to ask than
    // there are people.
    expect(small.length).toBe(3);

    await seed(NETWORK.slice(0, 0));
    expect(buildStarterQuestions(scope())).toEqual([]);

    // A varied network of a hundred people, well past the ten from which a
    // value must be shared by two. The pool holds every such value, far more
    // than the six the page draws, and never more than there are people.
    await seed(
      Array.from({ length: 120 }, (_, i) => ({
        name: `Person ${i}`,
        industry: `Industry ${String.fromCharCode(65 + (i % 12))}`,
        location: `City ${String.fromCharCode(65 + (i % 11))}, Somewhere`,
        company: `Company ${String.fromCharCode(65 + (i % 10))}`,
        role: `Role ${String.fromCharCode(65 + (i % 9))}`,
        interests: [`Hobby ${String.fromCharCode(65 + (i % 8))}`],
      })),
    );
    const medium = buildStarterQuestions(scope());
    expect(medium.length).toBeGreaterThan(40);
    expect(medium.length).toBeLessThanOrEqual(120);
  });

  it("is a large hidden list on a large network: many times the six it shows, and no more than the contacts", async () => {
    // 300 people, each value shared by several: 25 industries, 60 cities, 150
    // companies, 40 roles, 30 hobbies and 20 tags.
    await seed(
      Array.from({ length: 300 }, (_, i) => ({
        name: `Person ${i}`,
        industry: `Industry ${i % 25}`,
        location: `City ${i % 60}, Somewhere`,
        company: `Company ${i % 150}`,
        // A role with a digit in it is not a title, so the pool leaves it out.
        role: `Role ${String.fromCharCode(65 + (i % 26))}${i % 40 > 25 ? "X" : ""}`,
        interests: [`Hobby ${i % 30}`],
        tags: [`tag${i % 20}`],
      })),
    );
    const pool = buildStarterQuestions(scope());
    expect(pool.length).toBeGreaterThan(100);
    expect(pool.length).toBeLessThanOrEqual(Math.min(POOL_LIMIT, 300));
    // No question twice, and every kind takes part.
    expect(new Set(texts(pool)).size).toBe(pool.length);
    expect(new Set(pool.map((q) => q.kind)).size).toBeGreaterThanOrEqual(6);
  });

  it("finds the people each question names, with no model", async () => {
    const pool = buildStarterQuestions(scope());
    const holders = (q: StarterQuestion): string[] => {
      const has = (value: unknown, needle: string) =>
        typeof value === "string" &&
        value.toLowerCase().includes(needle.toLowerCase());
      const value = q.text
        .replace(
          /^Who (works in|do I know in|works at|is interested in|works as an?|is tagged) /,
          "",
        )
        .replace(/\?$/, "");
      return NETWORK.filter((person) => {
        switch (q.kind) {
          case "industry":
            return has(person.industry, value);
          case "city":
            return has(person.location, value);
          case "company":
            return has(person.company, value);
          case "role":
            return has(person.role, value);
          case "interest":
            return (person.interests ?? []).some((i) => has(i, value));
          case "tag":
            return (person.tags ?? []).some((t) => has(t, value));
          case "pair": {
            const [industry, city] = value.split(" in ");
            return (
              has(person.industry, industry!) && has(person.location, city!)
            );
          }
        }
      }).map((person) => person.name);
    };
    for (const q of pool.filter((entry) => entry.kind !== "general")) {
      const result = await searchService.semanticSearch(
        scope(),
        q.text,
        "starter-test",
        undefined,
        { aiAllowed: false },
      );
      const found = result.matches.map((match) => match.name);
      const expected = holders(q);
      expect(expected.length, q.text).toBeGreaterThanOrEqual(2);
      // Everyone the question was built from is found.
      for (const name of expected) expect(found, q.text).toContain(name);
      // A facet answers the questions about a field, so nobody else is.
      if (["industry", "city", "company", "pair"].includes(q.kind))
        expect(found.sort(), q.text).toEqual([...expected].sort());
    }
  });

  it("is served from memory until the contacts change", async () => {
    const first = starterQuestions(scope());
    expect(starterQuestions(scope())).toBe(first);

    // One edit: the old pool answers at once, and a new one is built behind
    // it.
    const [tom] = sqlite
      .prepare("SELECT id FROM contacts WHERE ownerId = ? AND name = ?")
      .all(localOwnerId(), "Tom Reed") as { id: string }[];
    sqlite
      .prepare("UPDATE contacts SET industry = 'Fintech' WHERE id = ?")
      .run(tom!.id);
    expect(starterQuestions(scope())).toBe(first);
    await new Promise((resolve) => setImmediate(resolve));
    const rebuilt = starterQuestions(scope());
    expect(rebuilt).not.toBe(first);
    expect(starterQuestions(scope())).toBe(rebuilt);

    // A bulk change is far past the old pool: the answer is built from the
    // contacts as they are now.
    await contactService.bulkCreateContacts(
      scope(),
      Array.from({ length: 30 }, (_, i) => ({
        name: `Sailor ${i}`,
        industry: "Maritime",
      })),
    );
    expect(texts(starterQuestions(scope()))).toContain(
      "Who works in Maritime?",
    );
  });

  it("builds a pool ahead of the request, after an import or at boot", async () => {
    scheduleStarterQuestions(localOwnerId());
    scheduleStarterQuestions(localOwnerId());
    await new Promise((resolve) => setImmediate(resolve));
    const scheduled = starterQuestions(scope());
    expect(texts(scheduled)).toContain("Who works in Fintech?");
    expect(starterQuestions(scope())).toBe(scheduled);

    resetStarterQuestions();
    expect(await warmStarterQuestions()).toBeGreaterThanOrEqual(1);
    const warmed = starterQuestions(scope());
    expect(starterQuestions(scope())).toBe(warmed);
    expect(texts(warmed)).toContain("Who works in Fintech?");
  });

  it("answers GET /api/search/starters with the pool", async () => {
    const res = await request(app).get("/api/search/starters");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ questions: buildStarterQuestions(scope()) });
  });
});

describe("the general questions in the pool", () => {
  // Twelve people, so a value must be shared by two, and every general
  // question has a different set of people to find.
  const PEOPLE = Array.from({ length: 12 }, (_, i) => ({
    name: `Person ${String(i).padStart(2, "0")}`,
    location: i < 9 ? `City ${i % 3}, Somewhere` : undefined,
    emails: i < 8 ? [`person${i}@example.com`] : [],
    phones: i < 6 ? [`+1 415 555 01${String(i).padStart(2, "0")}`] : [],
  }));
  const named = (from: number, to: number) =>
    PEOPLE.slice(from, to).map((person) => person.name);

  /** Who each question must find, by the numbers in PEOPLE. */
  const EXPECTED: Record<string, string[]> = {
    // Contacted 10 days ago (0 to 4), 200 days ago (5 and 6), or never.
    "Who haven't I contacted in over 3 months?": named(5, 12),
    "Who do I track?": named(0, 3),
    "Who am I not tracking yet?": named(3, 12),
    // Edited 300 days ago.
    "Whose details haven't been updated in over 6 months?": named(10, 12),
    "Who is missing an email address?": named(8, 12),
    "Who is missing a phone number?": named(6, 12),
    "Who is missing a location?": named(9, 12),
  };

  beforeEach(async () => {
    await seed(PEOPLE);
    const set = (sql: string, ...names: string[]) =>
      sqlite.prepare(sql).run(...names, localOwnerId());
    const inList = (n: number) =>
      Array.from({ length: n }, () => "?").join(",");
    sqlite
      .prepare(
        `UPDATE contacts SET isTracked = 1 WHERE name IN (${inList(3)}) AND ownerId = ?`,
      )
      .run(...named(0, 3), localOwnerId());
    set(
      `UPDATE contacts SET lastContactedAt = datetime('now', '-10 days') WHERE name IN (${inList(5)}) AND ownerId = ?`,
      ...named(0, 5),
    );
    set(
      `UPDATE contacts SET lastContactedAt = datetime('now', '-200 days') WHERE name IN (${inList(2)}) AND ownerId = ?`,
      ...named(5, 7),
    );
    set(
      `UPDATE contacts SET updatedAt = datetime('now', '-300 days') WHERE name IN (${inList(2)}) AND ownerId = ?`,
      ...named(10, 12),
    );
    resetStarterQuestions();
  });

  const generalTexts = () =>
    buildStarterQuestions(scope())
      .filter((q) => q.kind === "general")
      .map((q) => q.text);

  it("offers all seven, each as the general kind, when each finds somebody", () => {
    const pool = buildStarterQuestions(scope());
    expect(generalTexts().sort()).toEqual(
      GENERAL_QUESTIONS.map((q) => q.text).sort(),
    );
    expect(pool.filter((q) => q.kind === "general")).toHaveLength(7);
  });

  it("finds exactly the people each question names, through the real search with no model", async () => {
    for (const { text } of GENERAL_QUESTIONS) {
      const result = await searchService.semanticSearch(
        scope(),
        text,
        "general-test",
        undefined,
        { aiAllowed: false },
      );
      const found = result.matches.map((match) => match.name).sort();
      expect(found, text).toEqual([...EXPECTED[text]!].sort());
    }
  });

  it("leaves a question out when its facets find nobody", () => {
    // `updatedAt` is named, so the trigger that stamps it leaves the two
    // stale contacts as they are.
    sqlite
      .prepare(
        `UPDATE contacts SET isTracked = 0,
           updatedAt = CASE WHEN name IN (?, ?) THEN datetime('now', '-301 days') ELSE updatedAt END
         WHERE ownerId = ?`,
      )
      .run(...named(10, 12), localOwnerId());
    resetStarterQuestions();
    const texts = generalTexts();
    expect(texts).not.toContain("Who do I track?");
    expect(texts).toContain("Who am I not tracking yet?");
    expect(texts).toHaveLength(6);
  });

  it("follows tracking and contact without waiting for a search revision", () => {
    // Tracking, and the date of the last contact, are not searched columns,
    // so neither moves the revision the cached pool is kept by. A pool that
    // waited for the revision would offer "Who do I track?" after the last
    // person was untracked, and a press on it would find nobody.
    const cached = starterQuestions(scope());
    const before = sqlite
      .prepare("SELECT revision FROM search_revision WHERE ownerId = ?")
      .get(localOwnerId()) as { revision: number };

    sqlite
      .prepare("UPDATE contacts SET isTracked = 0 WHERE ownerId = ?")
      .run(localOwnerId());
    const after = sqlite
      .prepare("SELECT revision FROM search_revision WHERE ownerId = ?")
      .get(localOwnerId()) as { revision: number };
    expect(after.revision).toBe(before.revision);

    const untracked = starterQuestions(scope());
    expect(untracked).not.toBe(cached);
    expect(untracked.map((q) => q.text)).not.toContain("Who do I track?");

    sqlite
      .prepare(
        "UPDATE contacts SET isTracked = 1 WHERE name = ? AND ownerId = ?",
      )
      .run(PEOPLE[0]!.name, localOwnerId());
    expect(starterQuestions(scope()).map((q) => q.text)).toContain(
      "Who do I track?",
    );
  });

  it("returns the same pool, not a new one, while nothing it offers has changed", () => {
    const first = starterQuestions(scope());
    expect(starterQuestions(scope())).toBe(first);
    expect(starterQuestions(scope())).toBe(first);
  });

  it("is read by the search as its facets, and only when the whole question is one", () => {
    for (const { text, filters } of GENERAL_QUESTIONS) {
      const read = findImplicitFacets(scope(), text);
      expect(read.filters, text).toEqual(filters);
      expect(read.remainder, text).toBe("");
    }
    const near = findImplicitFacets(
      scope(),
      "Who haven't I contacted in over 4 months?",
    );
    expect(near.filters).toEqual([]);
  });
});

describe("article", () => {
  it("says a role the way it is spoken", () => {
    expect(article("Product Designer")).toBe("a");
    expect(article("Engineer")).toBe("an");
    expect(article("Investor")).toBe("an");
    expect(article("CTO")).toBe("a");
    expect(article("SVP of Sales")).toBe("an");
    expect(article("MBA Candidate")).toBe("an");
    expect(article("UX Designer")).toBe("a");
    expect(article("University Lecturer")).toBe("a");
    expect(article("Undergraduate Researcher")).toBe("an");
  });
});
