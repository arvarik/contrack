/**
 * tests/unit/email.normalize.test.ts — Unit tests for email normalization.
 */

import { describe, expect, it } from "vitest";
import {
  determineDirection,
  normalizeEmail,
  normalizeEmailAddress,
  parseAddressList,
  stripSubjectPrefixes,
} from "../../server/connectors/email/normalize.ts";

describe("normalizeEmailAddress", () => {
  it("trims whitespace and converts to lowercase", () => {
    expect(normalizeEmailAddress("  Alice@Example.COM  ")).toBe(
      "alice@example.com",
    );
  });

  it("handles null and undefined gracefully", () => {
    expect(normalizeEmailAddress(null)).toBe("");
    expect(normalizeEmailAddress(undefined)).toBe("");
    expect(normalizeEmailAddress("")).toBe("");
  });
});

describe("stripSubjectPrefixes", () => {
  it("strips standard Re and Fwd prefixes", () => {
    expect(stripSubjectPrefixes("Re: Project update")).toBe("Project update");
    expect(stripSubjectPrefixes("Fwd: Meeting notes")).toBe("Meeting notes");
    expect(stripSubjectPrefixes("Fw: Contract details")).toBe(
      "Contract details",
    );
  });

  it("strips nested and bracketed prefixes", () => {
    expect(stripSubjectPrefixes("Re: [Marketing] Fwd: Re[2]: Q3 Roadmap")).toBe(
      "Q3 Roadmap",
    );
    expect(stripSubjectPrefixes("  RE:  FW:  Hello  ")).toBe("Hello");
  });

  it("returns fallback for empty or whitespace-only subjects", () => {
    expect(stripSubjectPrefixes("")).toBe("(No subject)");
    expect(stripSubjectPrefixes(null)).toBe("(No subject)");
    expect(stripSubjectPrefixes("   ")).toBe("(No subject)");
    expect(stripSubjectPrefixes("Re: ")).toBe("(No subject)");
  });
});

describe("parseAddressList", () => {
  it("parses single string address with name and angle brackets", () => {
    const parsed = parseAddressList("Alice Smith <alice@example.com>");
    expect(parsed).toEqual([
      { name: "Alice Smith", email: "alice@example.com" },
    ]);
  });

  it("parses comma-separated string addresses", () => {
    const parsed = parseAddressList(
      'Bob <bob@example.com>, "Charlie, Jr." <charlie@example.com>, plain@example.com',
    );
    expect(parsed).toEqual([
      { name: "Bob", email: "bob@example.com" },
      { name: "Charlie, Jr.", email: "charlie@example.com" },
      { email: "plain@example.com" },
    ]);
  });

  it("parses array of address objects", () => {
    const parsed = parseAddressList([
      { name: "Dana", address: "dana@example.com" },
      { email: "Eve@Example.COM" },
    ]);
    expect(parsed).toEqual([
      { name: "Dana", email: "dana@example.com" },
      { email: "eve@example.com" },
    ]);
  });

  it("returns empty array for empty inputs", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
  });
});

describe("determineDirection", () => {
  const selfSet = new Set(["me@example.com", "alias@example.com"]);

  it("marks as out if From contains a self address", () => {
    expect(determineDirection([{ email: "me@example.com" }], selfSet)).toBe(
      "out",
    );
    expect(determineDirection([{ email: "alias@example.com" }], selfSet)).toBe(
      "out",
    );
  });

  it("marks as in if From does not contain any self address", () => {
    expect(determineDirection([{ email: "other@example.com" }], selfSet)).toBe(
      "in",
    );
  });
});

describe("normalizeEmail", () => {
  const selfEmails = ["me@example.com"];
  const aliases = ["work@company.com"];

  it("normalizes an incoming email correctly with privacy default (no body)", () => {
    const normalized = normalizeEmail(
      {
        messageId: "<msg-123@mail.com>",
        inReplyTo: "<msg-100@mail.com>",
        date: "2026-03-10T14:30:00Z",
        subject: "Re: Quick question",
        from: "Colleague <colleague@example.com>",
        to: "me@example.com",
        cc: "team@example.com",
        bodyText:
          "Here is the full email body that should be excluded by default.",
        snippet: "Here is the preview snippet",
      },
      { selfEmails, aliases },
    );

    expect(normalized.externalId).toBe("msg-123@mail.com");
    expect(normalized.messageId).toBe("msg-123@mail.com");
    expect(normalized.inReplyTo).toBe("msg-100@mail.com");
    expect(normalized.direction).toBe("in");
    expect(normalized.title).toBe("Quick question");
    expect(normalized.bodyText).toBeUndefined();
    expect(normalized.snippet).toBe("Here is the preview snippet");
    expect(normalized.from).toEqual([
      { name: "Colleague", email: "colleague@example.com" },
    ]);
    expect(normalized.participants[0]).toEqual({
      name: "Colleague",
      email: "colleague@example.com",
    });
  });

  it("includes bodyText when includeBody is true", () => {
    const normalized = normalizeEmail(
      {
        messageId: "<msg-456@mail.com>",
        date: "2026-03-10T15:00:00Z",
        subject: "Contract Signed",
        from: "Client <client@example.com>",
        to: "me@example.com",
        bodyText: "The contract is signed.",
      },
      { selfEmails, aliases, includeBody: true },
    );

    expect(normalized.bodyText).toBe("The contract is signed.");
  });

  it("normalizes an outgoing email placing recipients first in participants", () => {
    const normalized = normalizeEmail(
      {
        messageId: "<msg-out@mail.com>",
        date: "2026-03-10T16:00:00Z",
        subject: "Proposal",
        from: "work@company.com",
        to: "Partner <partner@example.com>",
        cc: "boss@company.com",
      },
      { selfEmails, aliases },
    );

    expect(normalized.direction).toBe("out");
    expect(normalized.participants[0]).toEqual({
      name: "Partner",
      email: "partner@example.com",
    });
  });
});
