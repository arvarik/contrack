import { describe, it, expect } from "vitest";
import {
  damerauLevenshtein,
  jaroWinkler,
} from "../../../../server/utils/nlp/distances.ts";

describe("NLP Distances", () => {
  it("computes damerauLevenshtein edit distances including transpositions and empty strings", () => {
    expect(damerauLevenshtein("test", "test")).toBe(0);
    expect(damerauLevenshtein("ca", "ac")).toBe(1);
    expect(damerauLevenshtein("smith", "smtih")).toBe(1);
    expect(damerauLevenshtein("test", "tests")).toBe(1);
    expect(damerauLevenshtein("tests", "test")).toBe(1);
    expect(damerauLevenshtein("jonathan", "jonathon")).toBe(1);
    expect(damerauLevenshtein("kitten", "sitting")).toBe(3);
    expect(damerauLevenshtein("", "test")).toBe(4);
    expect(damerauLevenshtein("test", "")).toBe(4);
    expect(damerauLevenshtein("", "")).toBe(0);
  });

  it("computes jaroWinkler similarity scores", () => {
    expect(jaroWinkler("marha", "marha")).toBe(1);
    expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.9);
    expect(jaroWinkler("dwayne", "duane")).toBeGreaterThan(0.8);
    expect(jaroWinkler("jones", "johnson")).toBeGreaterThan(0.7);
    expect(jaroWinkler("apple", "banana")).toBeLessThan(0.5);
    expect(jaroWinkler("", "test")).toBe(0);
    expect(jaroWinkler("test", "")).toBe(0);
  });
});
