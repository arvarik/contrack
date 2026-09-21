/**
 * The three score bands and their names.
 *
 * Every place that shows a score reads `shared/scoreBand.ts`: the avatar
 * ring, the list row's name, the command palette, and later the map and
 * Pulse. A threshold that moves here moves everywhere, so the edges are
 * pinned one number either side.
 */
import { describe, expect, it } from "vitest";
import {
  bandFor,
  bandInfo,
  contactScore,
  describeScore,
  FADING_MIN,
  NO_SCORE_TEXT,
  NOT_TRACKED_TEXT,
  SCORE_BANDS,
  scoreView,
  STRONG_MIN,
} from "../../shared/scoreBand";

describe("bandFor", () => {
  it("puts 70 and up in Strong, 40 to 69 in Fading, and under 40 in At risk", () => {
    expect(STRONG_MIN).toBe(70);
    expect(FADING_MIN).toBe(40);
    expect(bandFor(100)).toBe("strong");
    expect(bandFor(70)).toBe("strong");
    expect(bandFor(69)).toBe("fading");
    expect(bandFor(40)).toBe("fading");
    expect(bandFor(39)).toBe("at-risk");
    expect(bandFor(0)).toBe("at-risk");
  });

  it("clamps a score outside 0 to 100, and reads a non-number as At risk", () => {
    expect(bandFor(140)).toBe("strong");
    expect(bandFor(-5)).toBe("at-risk");
    expect(bandFor(Number.NaN)).toBe("at-risk");
  });

  it("reads a fraction by its value, not by rounding", () => {
    expect(bandFor(69.9)).toBe("fading");
    expect(bandFor(39.5)).toBe("at-risk");
  });
});

describe("the band names", () => {
  it("gives each band a sentence-case label and a colour token", () => {
    expect(SCORE_BANDS.strong).toEqual({
      band: "strong",
      label: "Strong",
      token: "success",
    });
    expect(SCORE_BANDS.fading).toEqual({
      band: "fading",
      label: "Fading",
      token: "warning",
    });
    expect(SCORE_BANDS["at-risk"]).toEqual({
      band: "at-risk",
      label: "At risk",
      token: "error",
    });
    expect(bandInfo(55)).toBe(SCORE_BANDS.fading);
  });

  it("says the score in words, in a tooltip and inside a sentence", () => {
    expect(describeScore(72)).toBe("Score 72, strong");
    expect(describeScore(12)).toBe("Score 12, at risk");
    expect(describeScore(41.6)).toBe("Score 42, fading");
    expect(describeScore(72, { sentence: true })).toBe("score 72, strong");
    expect(describeScore(null)).toBe(NO_SCORE_TEXT);
    expect(describeScore(undefined, { sentence: true })).toBe(
      "no interactions yet",
    );
  });
});

describe("contactScore", () => {
  it("is null for a contact with no logged interaction, whatever the column holds", () => {
    // The column defaults to 50, which is a placeholder and not a judgement.
    expect(
      contactScore({ relationshipScore: 50, lastContactedAt: null }),
    ).toBeNull();
    expect(contactScore({ relationshipScore: 50 })).toBeNull();
  });

  it("is the rounded, clamped score once there is an interaction", () => {
    const at = "2026-09-10T05:33:50.000Z";
    expect(contactScore({ relationshipScore: 72, lastContactedAt: at })).toBe(
      72,
    );
    expect(
      contactScore({ relationshipScore: 101.4, lastContactedAt: at }),
    ).toBe(100);
    expect(
      contactScore({ relationshipScore: null, lastContactedAt: at }),
    ).toBeNull();
  });
});

describe("scoreView", () => {
  const at = "2026-09-10T05:33:50.000Z";

  it("is untracked for a contact nobody chose to keep up with, whatever the column holds", () => {
    expect(
      scoreView({
        isTracked: false,
        relationshipScore: 72,
        lastContactedAt: at,
      }),
    ).toEqual({ kind: "untracked" });
    expect(NOT_TRACKED_TEXT).toBe("Not tracked");
  });

  it("is unscored for a tracked contact with no logged interaction", () => {
    expect(
      scoreView({
        isTracked: true,
        relationshipScore: 50,
        lastContactedAt: null,
      }),
    ).toEqual({ kind: "unscored" });
  });

  it("is scored, with the band, for a tracked contact with an interaction", () => {
    expect(
      scoreView({
        isTracked: true,
        relationshipScore: 72.4,
        lastContactedAt: at,
      }),
    ).toEqual({ kind: "scored", score: 72, band: SCORE_BANDS.strong });
    expect(
      scoreView({
        isTracked: true,
        relationshipScore: 12,
        lastContactedAt: at,
      }),
    ).toMatchObject({
      kind: "scored",
      score: 12,
      band: SCORE_BANDS["at-risk"],
    });
  });
});
