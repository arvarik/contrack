import { describe, it, expect } from "vitest";
import {
  scoreContactMatch,
  type MatchableContact,
} from "../../../../src/lib/contactMatch";

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

  // A phone field left empty normalizes to no digits at all, and "no
  // digits" is inside every number. Without the guard, one blank phone
  // made the contact match every numeric query.
  it("never matches an empty phone against a number", () => {
    expect(
      scoreContactMatch({ name: "Alice", phones: [{ phone: "" }] }, "555"),
    ).toBe(0);
  });
});
