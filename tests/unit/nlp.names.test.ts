import { describe, it, expect } from "vitest";
import {
  tokenizeName,
  nameSimilarity,
  isMiddleNameExtension,
} from "../../server/utils/nlp/names.ts";
import {
  areNicknameEquivalent,
  isNicknameMatch,
} from "../../server/utils/nlp/nicknames.ts";

describe("NLP Names & Nicknames", () => {
  describe("tokenizeName", () => {
    it("lowercases and extracts tokens while stripping titles", () => {
      expect(tokenizeName("Dr. Sarah Chen III")).toEqual(["sarah", "chen"]);
      expect(tokenizeName("Mr. John Doe")).toEqual(["john", "doe"]);
    });
  });

  describe("nameSimilarity", () => {
    it("scores exact matches perfectly", () => {
      expect(nameSimilarity("Robert Johnson", "Robert Johnson")).toBe(1);
    });

    it("scores nicknames highly", () => {
      expect(nameSimilarity("Robert Johnson", "Bob Johnson")).toBeGreaterThan(
        0.9,
      );
    });

    it("handles initials", () => {
      expect(nameSimilarity("J. Smith", "James Smith")).toBeGreaterThan(0.8);
    });

    it("gives low scores to unrelated names", () => {
      expect(nameSimilarity("James Kirk", "Vladimir Petrov")).toBeLessThan(0.6);
    });
  });

  describe("isNicknameMatch", () => {
    it("detects structural nickname pairs correctly", () => {
      expect(isNicknameMatch("Robert Johnson", "Bob Johnson")).toBe(true);
      expect(isNicknameMatch("Robert", "Bob")).toBe(true);

      expect(isNicknameMatch("Robert Johnson", "Bob Smith")).toBe(false);
      expect(isNicknameMatch("John Smith", "John Smith")).toBe(false); // Exact match, not a nickname variant
    });
  });

  describe("areNicknameEquivalent", () => {
    it("identifies equivalent names", () => {
      expect(areNicknameEquivalent("robert", "bob")).toBe(true);
      expect(areNicknameEquivalent("william", "bill")).toBe(true);
    });
  });
  describe("isMiddleNameExtension", () => {
    const check = (a: string, b: string) =>
      isMiddleNameExtension(tokenizeName(a), tokenizeName(b));

    it("matches one added middle name, in either order", () => {
      expect(check("Anton Kovacs", "Anton Peter Kovacs")).toBe(true);
      expect(check("Anton Peter Kovacs", "Anton Kovacs")).toBe(true);
    });

    it("matches two added middle names", () => {
      expect(check("Richard Bexwell", "Richard Alexander James Bexwell")).toBe(
        true,
      );
    });

    it("matches a middle initial, because the tokenizer drops the dot", () => {
      expect(check("Anton Kovacs", "Anton P. Kovacs")).toBe(true);
    });

    it("refuses a dropped first name", () => {
      // Somebody who goes by their middle name, or somebody else. Either way
      // the surname alone is not enough to merge on.
      expect(check("Peter Kovacs", "Anton Peter Kovacs")).toBe(false);
    });

    it("refuses two different middle names", () => {
      // The lengths are equal, so neither is an extension of the other. This
      // is the father-and-son shape.
      expect(check("Robert Lee Smith", "Robert Ann Smith")).toBe(false);
    });

    it("refuses a different surname", () => {
      expect(check("Anton Kovacs", "Anton Peter Zeller")).toBe(false);
    });

    it("refuses a different first name", () => {
      expect(check("Marta Kovacs", "Anton Peter Kovacs")).toBe(false);
    });

    it("refuses a single token on either side", () => {
      expect(check("Kovacs", "Anton Kovacs")).toBe(false);
      expect(check("Anton", "Anton Peter Kovacs")).toBe(false);
    });

    it("refuses an identical name", () => {
      // Exact names are somebody else's rule. This one only answers the
      // question it is asked.
      expect(check("Anton Kovacs", "Anton Kovacs")).toBe(false);
    });

    it("refuses an empty name", () => {
      expect(check("", "Anton Peter Kovacs")).toBe(false);
      expect(check("Anton Kovacs", "")).toBe(false);
    });

    it("ignores a title or a suffix, because the tokenizer strips them", () => {
      // "Dr. Anton Kovacs" and "Anton Peter Kovacs" differ by a middle name
      // once the honorific is gone, which is the right answer.
      expect(check("Dr. Anton Kovacs", "Anton Peter Kovacs")).toBe(true);
      // And a suffix cannot masquerade as a middle name: both sides tokenize
      // to two tokens, so there is no extension.
      expect(check("Anton Kovacs Jr.", "Anton Kovacs")).toBe(false);
    });

    it("requires the shorter name's tokens to appear in order", () => {
      // "kovacs anton" reversed is not an extension of "anton kovacs", and the
      // first-and-last-token checks are what refuse it.
      expect(check("Anton Kovacs", "Kovacs Peter Anton")).toBe(false);
    });
  });
});
