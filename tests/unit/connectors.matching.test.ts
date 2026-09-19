/**
 * tests/unit/connectors.matching.test.ts — Unit tests for participant matching.
 *
 * Verifies email case-folding, phone normalization, self-address exclusion,
 * primary contact ownership vs mention routing, and unknown participant collection.
 */

import { describe, expect, it } from "vitest";
import { createMatcherFromMaps } from "../../server/connectors/matching.ts";
import type { Participant } from "../../shared/connectors.ts";

describe("connectors matching", () => {
  it("folds email casing so mixed case matches lowercase contact email", () => {
    const emailMap = new Map<string, string>([
      ["alice@example.com", "contact-alice"],
    ]);
    const phoneMap = new Map<string, string>();
    const matcher = createMatcherFromMaps(emailMap, phoneMap);

    const participant: Participant = {
      email: "ALICE@Example.COM",
      name: "Alice",
    };
    const result = matcher.resolveContactId(participant);
    expect(result).toBe("contact-alice");
  });

  it("normalizes phone formats to match equivalent international/local representations", () => {
    const emailMap = new Map<string, string>();
    const phoneMap = new Map<string, string>([["4155550100", "contact-bob"]]);
    const matcher = createMatcherFromMaps(emailMap, phoneMap);

    const participant: Participant = {
      phone: "+1 (415) 555-0100",
      name: "Bob",
    };
    const result = matcher.resolveContactId(participant);
    expect(result).toBe("contact-bob");
  });

  it("excludes self addresses from becoming primary or mentions and flags hasSelf", () => {
    const emailMap = new Map<string, string>([
      ["me@work.com", "contact-self"],
      ["alice@example.com", "contact-alice"],
    ]);
    const phoneMap = new Map<string, string>();
    const matcher = createMatcherFromMaps(emailMap, phoneMap);

    const participants: Participant[] = [
      { email: "ME@Work.com", name: "Me" },
      { email: "alice@example.com", name: "Alice" },
    ];

    const match = matcher.matchParticipants(participants, {
      emails: ["me@work.com"],
      phones: [],
    });

    expect(match.hasSelf).toBe(true);
    expect(match.primaryContactId).toBe("contact-alice");
    expect(match.mentionContactIds).toEqual([]);
    expect(match.unknownParticipants).toEqual([]);
  });

  it("assigns first non-self match as primary and subsequent matches as mentions", () => {
    const emailMap = new Map<string, string>([
      ["alice@example.com", "contact-alice"],
      ["bob@example.com", "contact-bob"],
      ["charlie@example.com", "contact-charlie"],
    ]);
    const phoneMap = new Map<string, string>();
    const matcher = createMatcherFromMaps(emailMap, phoneMap);

    const participants: Participant[] = [
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com", name: "Bob" },
      { email: "charlie@example.com", name: "Charlie" },
    ];

    const match = matcher.matchParticipants(participants, {
      emails: ["host@example.com"],
      phones: [],
    });

    expect(match.primaryContactId).toBe("contact-alice");
    expect(match.mentionContactIds).toEqual(["contact-bob", "contact-charlie"]);
    expect(match.unknownParticipants).toEqual([]);
  });

  it("records unmatched participants as unknownParticipants", () => {
    const emailMap = new Map<string, string>([
      ["alice@example.com", "contact-alice"],
    ]);
    const phoneMap = new Map<string, string>();
    const matcher = createMatcherFromMaps(emailMap, phoneMap);

    const stranger: Participant = {
      email: "stranger@other.com",
      name: "Stranger",
    };
    const participants: Participant[] = [
      { email: "alice@example.com", name: "Alice" },
      stranger,
    ];

    const match = matcher.matchParticipants(participants, {
      emails: [],
      phones: [],
    });

    expect(match.primaryContactId).toBe("contact-alice");
    expect(match.mentionContactIds).toEqual([]);
    expect(match.unknownParticipants).toEqual([stranger]);
  });

  it("dynamically registers new contact IDs into active matcher", () => {
    const emailMap = new Map<string, string>();
    const phoneMap = new Map<string, string>();
    const matcher = createMatcherFromMaps(emailMap, phoneMap);

    expect(matcher.resolveContactId({ email: "new@example.com" })).toBeNull();

    matcher.registerContact(
      "contact-new",
      ["new@example.com"],
      ["+1 415 555 9999"],
    );

    expect(matcher.resolveContactId({ email: "NEW@example.com" })).toBe(
      "contact-new",
    );
    expect(matcher.resolveContactId({ phone: "415-555-9999" })).toBe(
      "contact-new",
    );
  });
});
