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
    const pool = buildStarterQuestions(scope());
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

    // A large, varied network fills the pool to its limit and no further.
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
    expect(buildStarterQuestions(scope())).toHaveLength(POOL_LIMIT);
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
    for (const q of pool) {
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
