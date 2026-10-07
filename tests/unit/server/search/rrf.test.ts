// Weighted reciprocal rank fusion
// score(d) = sum over the lists that rank d of weight / (k + rank), with
// 1-based ranks. Pure computation: no database, no model.

import { describe, it, expect } from "vitest";
import {
  reciprocalRankFusion,
  RRF_K,
  type FusionList,
  type RankedItem,
} from "../../../../server/services/search/hybridRetrieval.ts";

const ranked = (...ids: string[]): RankedItem[] =>
  ids.map((contactId, i) => ({ contactId, rank: i + 1 }));
const at = (contactId: string, rank: number): RankedItem[] => [
  { contactId, rank },
];
const lexical = (items: RankedItem[], weight = 1): FusionList => ({
  channel: "lexical",
  weight,
  items,
});
const dense = (items: RankedItem[], weight = 1): FusionList => ({
  channel: "dense",
  weight,
  items,
});
const ids = (lists: FusionList[], k?: number) =>
  reciprocalRankFusion(lists, k).map((c) => c.contactId);

describe("reciprocal rank fusion, unweighted", () => {
  it("merges results from multiple channels with correct scoring", () => {
    const result = reciprocalRankFusion([
      lexical(ranked("a", "b", "c")),
      dense(ranked("b", "d", "a")),
    ]);

    // "b" is rank 2 in lexical + rank 1 in dense → highest combined score
    expect(result[0].contactId).toBe("b");
    // "a" is rank 1 in lexical + rank 3 in dense → second highest
    expect(result[1].contactId).toBe("a");
    // Both should have both channels
    expect(result[0].channels).toContain("lexical");
    expect(result[0].channels).toContain("dense");
  });

  it("handles single-channel results correctly", () => {
    const result = reciprocalRankFusion([lexical(ranked("x", "y"))]);
    expect(result).toHaveLength(2);
    expect(result[0].contactId).toBe("x");
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[0].channels).toEqual(["lexical"]);
  });

  it("handles empty channel results gracefully", () => {
    expect(reciprocalRankFusion([lexical([]), dense([])])).toEqual([]);
  });

  it("boosts contacts appearing in both channels", () => {
    const result = reciprocalRankFusion([
      lexical(at("x", 5)),
      dense(at("x", 5)),
      // "y" appears only once but at rank 1
      lexical(at("y", 1)),
    ]);

    // "x" should rank higher despite rank 5 in each channel,
    // because 2× contributions beat 1× contribution
    const xResult = result.find((r) => r.contactId === "x")!;
    const yResult = result.find((r) => r.contactId === "y")!;

    expect(xResult.score).toBeGreaterThan(yResult.score);
    expect(xResult.channels).toHaveLength(2);
    expect(yResult.channels).toHaveLength(1);
  });

  it("deduplicates contacts across channels", () => {
    const result = reciprocalRankFusion([
      lexical(at("same", 1)),
      dense(at("same", 1)),
    ]);
    // Should appear once, not twice
    expect(result).toHaveLength(1);
    expect(result[0].contactId).toBe("same");
    // Score should be sum of both contributions: 1/(k+1) + 1/(k+1)
    expect(result[0].score).toBeCloseTo(2 / (RRF_K + 1), 8);
  });

  it("returns every contact it was given", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `c${i}`);
    expect(reciprocalRankFusion([lexical(ranked(...fifty))])).toHaveLength(50);
  });
});

describe("reciprocal rank fusion, weighted", () => {
  it("scores each list by weight / (k + rank)", () => {
    const [a, b] = reciprocalRankFusion([
      lexical(at("a", 1), 0.7),
      dense(at("b", 2), 0.3),
    ]);
    expect(a.score).toBeCloseTo(0.7 / (RRF_K + 1), 10);
    expect(b.score).toBeCloseTo(0.3 / (RRF_K + 2), 10);
  });

  it("lets the heavier channel win when both rank a contact first", () => {
    const lists = (lexicalWeight: number) => [
      lexical(at("keyword", 1), lexicalWeight),
      dense(at("vector", 1), 1 - lexicalWeight),
    ];
    expect(ids(lists(0.7))).toEqual(["keyword", "vector"]);
    expect(ids(lists(0.3))).toEqual(["vector", "keyword"]);
  });

  it("takes k as its second argument", () => {
    const [only] = reciprocalRankFusion([lexical(at("a", 1), 0.5)], 60);
    expect(only.score).toBeCloseTo(0.5 / 61, 10);
  });

  it("gives a channel with 0 hits no say", () => {
    const alone = reciprocalRankFusion([lexical(ranked("a", "b"), 0.5)]);
    const withEmpty = reciprocalRankFusion([
      lexical(ranked("a", "b"), 0.5),
      dense([], 0.5),
    ]);
    expect(withEmpty).toEqual(alone);
  });

  it("keeps the order in which the lists reached tied contacts", () => {
    expect(ids([lexical(at("a", 1), 0.5), dense(at("b", 1), 0.5)])).toEqual([
      "a",
      "b",
    ]);
    expect(ids([dense(at("b", 1), 0.5), lexical(at("a", 1), 0.5)])).toEqual([
      "b",
      "a",
    ]);
  });

  it("gives the same order on every run", () => {
    const lists = [
      lexical(ranked("a", "b", "c", "d"), 0.5),
      dense(ranked("d", "c", "b", "a"), 0.5),
    ];
    const first = ids(lists);
    for (let run = 0; run < 5; run++) expect(ids(lists)).toEqual(first);
  });

  it("labels trait lists, which can lift a contact both channels ranked low", () => {
    const traits: FusionList[] = [
      { channel: "trait", weight: 0.15, items: ranked("c") },
      { channel: "trait", weight: 0.15, items: ranked("c") },
    ];
    const result = reciprocalRankFusion([
      lexical(ranked("a", "b", "c"), 0.5),
      dense(ranked("b", "a", "c"), 0.5),
      ...traits,
    ]);
    expect(result[0].contactId).toBe("c");
    expect(result[0].channels).toEqual(["lexical", "dense", "trait"]);
  });
});
