import { describe, it, expect } from "vitest";
import {
  tokenizeName,
  nameSimilarity,
  isMiddleNameExtension,
} from "../../../../server/utils/nlp/names.ts";
import {
  areNicknameEquivalent,
  isNicknameMatch,
} from "../../../../server/utils/nlp/nicknames.ts";

describe("NLP Names & Nicknames", () => {
  describe("tokenizeName", () => {
    it("lowercases and extracts tokens while stripping titles", () => {
      expect(tokenizeName("Dr. Sarah Chen III")).toEqual(["sarah", "chen"]);
      expect(tokenizeName("Mr. John Doe")).toEqual(["john", "doe"]);
    });
  });

  describe("nameSimilarity", () => {
    it("scores exact matches, nicknames, initials, typos, and unrelated names", () => {
      expect(nameSimilarity("Robert Johnson", "Robert Johnson")).toBe(1);
      expect(nameSimilarity("Robert Johnson", "Bob Johnson")).toBeGreaterThan(
        0.9,
      );
      expect(nameSimilarity("J. Smith", "James Smith")).toBeGreaterThan(0.8);
      expect(nameSimilarity("James Kirk", "Vladimir Petrov")).toBeLessThan(0.6);

      for (const [a, b, min] of [
        ["Jonathon Smyth", "Jonathan Smith", 0.9],
        ["Katharine Oconnel", "Katherine O'Connell", 0.9],
        ["Shivaun Murphey", "Siobhan Murphy", 0.8],
        ["Kristof Novak", "Krzysztof Nowak", 0.85],
        ["Eefa Gallacher", "Aoife Gallagher", 0.85],
        ["Jeffrey Thwaight", "Geoffrey Thwaite", 0.9],
        ["Xiomarra Reyez", "Xiomara Reyes", 0.9],
        ["Bartholemew Quigly", "Bartholomew Quigley", 0.9],
      ] as const) {
        expect(nameSimilarity(a, b), `${a} vs ${b}`).toBeGreaterThan(min);
      }
    });
  });

  describe("isNicknameMatch & areNicknameEquivalent", () => {
    it("detects structural nickname pairs and equivalent nicknames", () => {
      expect(isNicknameMatch("Robert Johnson", "Bob Johnson")).toBe(true);
      expect(isNicknameMatch("Robert", "Bob")).toBe(true);
      expect(isNicknameMatch("Robert Johnson", "Bob Smith")).toBe(false);
      expect(isNicknameMatch("John Smith", "John Smith")).toBe(false);

      expect(areNicknameEquivalent("robert", "bob")).toBe(true);
      expect(areNicknameEquivalent("william", "bill")).toBe(true);
    });
  });

  describe("isMiddleNameExtension", () => {
    const check = (a: string, b: string) =>
      isMiddleNameExtension(tokenizeName(a), tokenizeName(b));

    it("matches added middle names or initials and strips honorifics", () => {
      expect(check("Anton Kovacs", "Anton Peter Kovacs")).toBe(true);
      expect(check("Anton Peter Kovacs", "Anton Kovacs")).toBe(true);
      expect(check("Richard Bexwell", "Richard Alexander James Bexwell")).toBe(
        true,
      );
      expect(check("Anton Kovacs", "Anton P. Kovacs")).toBe(true);
      expect(check("Dr. Anton Kovacs", "Anton Peter Kovacs")).toBe(true);
    });

    it.each([
      ["a dropped first name", "Peter Kovacs", "Anton Peter Kovacs"],
      ["two different middle names", "Robert Lee Smith", "Robert Ann Smith"],
      ["a different surname", "Anton Kovacs", "Anton Peter Zeller"],
      ["a different first name", "Marta Kovacs", "Anton Peter Kovacs"],
      ["a single token", "Kovacs", "Anton Kovacs"],
      ["a single first token", "Anton", "Anton Peter Kovacs"],
      ["an identical name", "Anton Kovacs", "Anton Kovacs"],
      ["an empty first name", "", "Anton Peter Kovacs"],
      ["an empty second name", "Anton Kovacs", ""],
      ["a stripped suffix", "Anton Kovacs Jr.", "Anton Kovacs"],
      ["reversed tokens", "Anton Kovacs", "Kovacs Peter Anton"],
    ])("refuses %s", (_what, a, b) => {
      expect(check(a, b)).toBe(false);
    });
  });
});
