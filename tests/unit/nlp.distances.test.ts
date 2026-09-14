import { describe, it, expect } from "vitest";
import {
  levenshteinDistance,
  damerauLevenshtein,
  jaroWinkler,
} from "../../server/utils/nlp/distances.ts";

describe("NLP Distances", () => {
  describe("levenshteinDistance", () => {
    it("returns 0 for identical strings", () => {
      expect(levenshteinDistance("test", "test")).toBe(0);
    });

    it("calculates correct distance for insertions/deletions", () => {
      expect(levenshteinDistance("test", "tests")).toBe(1);
      expect(levenshteinDistance("test", "tes")).toBe(1);
    });

    it("calculates correct distance for substitutions", () => {
      expect(levenshteinDistance("kitten", "sitting")).toBe(3);
      expect(levenshteinDistance("flaw", "lawn")).toBe(2);
    });

    it("handles empty strings", () => {
      expect(levenshteinDistance("", "test")).toBe(4);
      expect(levenshteinDistance("test", "")).toBe(4);
      expect(levenshteinDistance("", "")).toBe(0);
    });
  });

  describe("damerauLevenshtein", () => {
    it("returns 0 for identical strings", () => {
      expect(damerauLevenshtein("test", "test")).toBe(0);
    });

    it("counts single adjacent transposition as 1 edit", () => {
      expect(damerauLevenshtein("ca", "ac")).toBe(1);
      expect(damerauLevenshtein("smith", "smtih")).toBe(1);
      // Levenshtein would count transpositions as 2 edits
      expect(levenshteinDistance("ca", "ac")).toBe(2);
      expect(levenshteinDistance("smith", "smtih")).toBe(2);
    });

    it("calculates correct distance for insertions and deletions", () => {
      expect(damerauLevenshtein("test", "tests")).toBe(1);
      expect(damerauLevenshtein("tests", "test")).toBe(1);
    });

    it("calculates correct distance for substitutions", () => {
      expect(damerauLevenshtein("jonathan", "jonathon")).toBe(1);
      expect(damerauLevenshtein("kitten", "sitting")).toBe(3);
    });

    it("handles empty strings", () => {
      expect(damerauLevenshtein("", "test")).toBe(4);
      expect(damerauLevenshtein("test", "")).toBe(4);
      expect(damerauLevenshtein("", "")).toBe(0);
    });
  });

  describe("jaroWinkler", () => {
    it("returns 1 for identical strings", () => {
      expect(jaroWinkler("marha", "marha")).toBe(1);
    });

    it("returns high score for transpositions", () => {
      expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.9);
    });

    it("returns low score for unrelated strings", () => {
      expect(jaroWinkler("dwayne", "duane")).toBeGreaterThan(0.8);
      expect(jaroWinkler("jones", "johnson")).toBeGreaterThan(0.7);
      expect(jaroWinkler("apple", "banana")).toBeLessThan(0.5);
    });

    it("handles empty strings gracefully", () => {
      expect(jaroWinkler("", "test")).toBe(0);
      expect(jaroWinkler("test", "")).toBe(0);
    });
  });
});
