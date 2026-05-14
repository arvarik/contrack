import { describe, it, expect } from "vitest";
import { tokenizeName, nameSimilarity } from "../../server/utils/nlp/names.ts";
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
});
