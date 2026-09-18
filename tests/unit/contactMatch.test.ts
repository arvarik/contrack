import { describe, it, expect } from "vitest";
import {
  scoreContactMatch,
  type MatchableContact,
} from "../../src/lib/contactMatch";

describe("scoreContactMatch", () => {
  it("returns 0 for empty or whitespace query", () => {
    const contact: MatchableContact = { name: "Ada Lovelace" };
    expect(scoreContactMatch(contact, "")).toBe(0);
    expect(scoreContactMatch(contact, "   ")).toBe(0);
  });

  it("returns 0 when nothing matches", () => {
    const contact: MatchableContact = {
      name: "Ada Lovelace",
      company: "Babbage & Co",
    };
    expect(scoreContactMatch(contact, "xyz")).toBe(0);
  });

  it("scores 100 for exact name match", () => {
    const contact: MatchableContact = { name: "Ada Lovelace" };
    expect(scoreContactMatch(contact, "ada lovelace")).toBe(100);
    expect(scoreContactMatch(contact, "ADA LOVELACE")).toBe(100);
  });

  it("scores 50 for name prefix match", () => {
    const contact: MatchableContact = { name: "Ada Lovelace" };
    expect(scoreContactMatch(contact, "ada")).toBe(50);
  });

  it("scores 30 for name substring match", () => {
    const contact: MatchableContact = { name: "Ada Lovelace" };
    expect(scoreContactMatch(contact, "love")).toBe(30);
  });

  it("scores 10 for company, role, location, industry, tag, email, and phone", () => {
    expect(
      scoreContactMatch({ name: "Person", company: "Stripe" }, "stripe"),
    ).toBe(10);
    expect(
      scoreContactMatch({ name: "Person", role: "Engineer" }, "engineer"),
    ).toBe(10);
    expect(
      scoreContactMatch({ name: "Person", location: "London" }, "london"),
    ).toBe(10);
    expect(
      scoreContactMatch({ name: "Person", industry: "Fintech" }, "fintech"),
    ).toBe(10);
    expect(
      scoreContactMatch(
        { name: "Person", tags: [{ tag: "Founder" }] },
        "founder",
      ),
    ).toBe(10);
    expect(
      scoreContactMatch({ name: "Person", tags: ["Founder"] }, "founder"),
    ).toBe(10);
    expect(
      scoreContactMatch(
        { name: "Person", emails: [{ email: "ada@babbage.com" }] },
        "babbage",
      ),
    ).toBe(10);
    expect(
      scoreContactMatch(
        { name: "Person", phones: [{ phone: "(555) 123-4567" }] },
        "5551234567",
      ),
    ).toBe(10);
  });

  it("accumulates scores across multiple matching fields", () => {
    const contact: MatchableContact = {
      name: "Ada Lovelace",
      company: "Analytical Engines Inc",
      role: "Founder",
      location: "London, UK",
      industry: "Computing",
      tags: [{ tag: "Pioneer" }],
      emails: [{ email: "ada@analytical.org" }],
    };

    // Name prefix (50) + role (10)
    expect(
      scoreContactMatch({ name: "Ada Lovelace", role: "Ada Engineer" }, "ada"),
    ).toBe(60);

    // Company (10) + email (10)
    expect(scoreContactMatch(contact, "analytical")).toBe(20);
  });

  it("produces identical ranking order to the list scoring", () => {
    const contacts: MatchableContact[] = [
      {
        id: "c1",
        name: "Bob Martin",
        company: "Clean Code",
      } as MatchableContact,
      { id: "c2", name: "Alice", company: "Alice Corp" } as MatchableContact,
      {
        id: "c3",
        name: "Alice Wonderland",
        company: "Other",
      } as MatchableContact,
      { id: "c4", name: "Carol", company: "Alice Corp" } as MatchableContact,
      { id: "c5", name: "Malice Cooper", company: "Other" } as MatchableContact,
    ];

    const q = "alice";
    const scored = contacts
      .map((c) => ({ c, score: scoreContactMatch(c, q) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    // c2: exact name (100) + company (10) = 110
    // c3: prefix name (50) = 50
    // c5: substring name (30) = 30
    // c4: company (10) = 10
    expect(scored.map((item) => item.c.name)).toEqual([
      "Alice",
      "Alice Wonderland",
      "Malice Cooper",
      "Carol",
    ]);
  });
});
