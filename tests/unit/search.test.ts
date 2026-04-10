// =============================================================================
// Unit Tests — Hybrid Retrieval v3 (RRF Fusion, k=15)
// =============================================================================
// Tests for the Reciprocal Rank Fusion algorithm used in Ask Contrack v3.
// Pure computation — no database, no API calls.
// =============================================================================

import { describe, it, expect } from "vitest";
import { reciprocalRankFusion } from "../../server/services/search/hybridRetrieval.ts";

const RRF_K = 15; // Must match the constant in hybridRetrieval.ts

describe("Reciprocal Rank Fusion (k=15)", () => {
  it("merges results from multiple channels with correct scoring", () => {
    const fts = [
      { contactId: "a", rank: 1, channel: "fts" as const },
      { contactId: "b", rank: 2, channel: "fts" as const },
      { contactId: "c", rank: 3, channel: "fts" as const },
    ];

    const vector = [
      { contactId: "b", rank: 1, channel: "vector" as const },
      { contactId: "d", rank: 2, channel: "vector" as const },
      { contactId: "a", rank: 3, channel: "vector" as const },
    ];

    const result = reciprocalRankFusion([fts, vector]);

    // "b" is rank 2 in FTS + rank 1 in vector → highest combined score
    expect(result[0].contactId).toBe("b");
    // "a" is rank 1 in FTS + rank 3 in vector → second highest
    expect(result[1].contactId).toBe("a");
    // Both should have both channels
    expect(result[0].channels).toContain("fts");
    expect(result[0].channels).toContain("vector");
  });

  it("handles single-channel results correctly", () => {
    const fts = [
      { contactId: "x", rank: 1, channel: "fts" as const },
      { contactId: "y", rank: 2, channel: "fts" as const },
    ];

    const result = reciprocalRankFusion([fts]);
    expect(result).toHaveLength(2);
    expect(result[0].contactId).toBe("x");
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[0].channels).toEqual(["fts"]);
  });

  it("handles empty channel results gracefully", () => {
    const result = reciprocalRankFusion([[], []]);
    expect(result).toEqual([]);
  });

  it("boosts contacts appearing in both channels", () => {
    const fts = [{ contactId: "x", rank: 5, channel: "fts" as const }];
    const vector = [{ contactId: "x", rank: 5, channel: "vector" as const }];

    // "y" appears only once but at rank 1
    const fts2 = [{ contactId: "y", rank: 1, channel: "fts" as const }];

    const result = reciprocalRankFusion([fts, vector, fts2]);

    // "x" should rank higher despite rank 5 in each channel,
    // because 2× contributions beat 1× contribution
    const xResult = result.find(r => r.contactId === "x")!;
    const yResult = result.find(r => r.contactId === "y")!;

    expect(xResult.score).toBeGreaterThan(yResult.score);
    expect(xResult.channels).toHaveLength(2);
    expect(yResult.channels).toHaveLength(1);
  });

  it("respects the limit parameter", () => {
    const fts = Array.from({ length: 20 }, (_, i) => ({
      contactId: `c${i}`,
      rank: i + 1,
      channel: "fts" as const,
    }));

    const result = reciprocalRankFusion([fts], 5);
    expect(result).toHaveLength(5);
    expect(result[0].contactId).toBe("c0");
  });

  it("deduplicates contacts across channels", () => {
    const fts = [{ contactId: "same", rank: 1, channel: "fts" as const }];
    const vector = [{ contactId: "same", rank: 1, channel: "vector" as const }];

    const result = reciprocalRankFusion([fts, vector]);
    // Should appear once, not twice
    expect(result).toHaveLength(1);
    expect(result[0].contactId).toBe("same");
    // Score should be sum of both contributions: 1/(15+1) + 1/(15+1)
    const expectedScore = 1 / (RRF_K + 1) + 1 / (RRF_K + 1);
    expect(result[0].score).toBeCloseTo(expectedScore, 8);
  });

  it("provides sharper discrimination than k=60 for small datasets", () => {
    // With k=15: rank 1 = 1/16 = 0.0625, rank 10 = 1/25 = 0.04 → 36% drop
    // With k=60: rank 1 = 1/61 = 0.0164, rank 10 = 1/70 = 0.0143 → 13% drop
    const rank1Score = 1 / (RRF_K + 1);
    const rank10Score = 1 / (RRF_K + 10);
    const dropPercent = (rank1Score - rank10Score) / rank1Score;

    // k=15 should have >30% discrimination between rank 1 and rank 10
    expect(dropPercent).toBeGreaterThan(0.3);
  });

  it("returns all results when no limit is specified", () => {
    const fts = Array.from({ length: 50 }, (_, i) => ({
      contactId: `c${i}`,
      rank: i + 1,
      channel: "fts" as const,
    }));

    const result = reciprocalRankFusion([fts]);
    expect(result).toHaveLength(50);
  });
});
