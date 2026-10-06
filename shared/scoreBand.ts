/**
 * What a relationship score (0 to 100, `contacts.relationshipScore`) means,
 * in three bands. Every place that shows a score reads them here.
 *
 * | Band      | Score     | Label     | Token     |
 * | --------- | --------- | --------- | --------- |
 * | `strong`  | 70 to 100 | "Strong"  | `success` |
 * | `fading`  | 40 to 69  | "Fading"  | `warning` |
 * | `at-risk` | 0 to 39   | "At risk" | `error`   |
 *
 * Only a tracked contact has a score. The client reads a score only through
 * `scoreView`: `untracked`, `unscored` or `scored`. "Catch up", "rising" and
 * "cooling" are other facts, which Pulse names itself.
 *
 * This file imports nothing, so the server and the client both read it.
 */

type ScoreBand = "strong" | "fading" | "at-risk";

/** The lowest score in the Strong band. */
export const STRONG_MIN = 70;

/** The lowest score in the Fading band. A score under it is At risk. */
export const FADING_MIN = 40;

interface ScoreBandInfo {
  band: ScoreBand;
  /** The word shown to a person, in sentence case: "Strong", "At risk". */
  label: string;
  /**
   * The color token, without its prefix: `success` is `--color-success` in
   * CSS and `text-success` or `stroke-success` in a class.
   */
  token: "success" | "warning" | "error";
}

export const SCORE_BANDS: Readonly<Record<ScoreBand, ScoreBandInfo>> = {
  strong: { band: "strong", label: "Strong", token: "success" },
  fading: { band: "fading", label: "Fading", token: "warning" },
  "at-risk": { band: "at-risk", label: "At risk", token: "error" },
};

/**
 * The band a score falls in, after clamping to 0 to 100. A value that is
 * not a number is At risk: a caller that can have no score checks first.
 */
export function bandFor(score: number): ScoreBand {
  if (!Number.isFinite(score)) return "at-risk";
  const clamped = Math.min(100, Math.max(0, score));
  if (clamped >= STRONG_MIN) return "strong";
  if (clamped >= FADING_MIN) return "fading";
  return "at-risk";
}

/** The label, the token and the band for a score. */
export function bandInfo(score: number): ScoreBandInfo {
  return SCORE_BANDS[bandFor(score)];
}

/** Said when a contact has no logged interaction, so the score means nothing. */
export const NO_SCORE_TEXT = "No interactions yet";

/**
 * The score in words: "Score 72, strong", or "No interactions yet" for null.
 * `{ sentence: true }` lowercases the first letter, for mid-sentence use
 * ("Rowan Vale, Northwind Partners, score 72, strong").
 */
export function describeScore(
  score: number | null | undefined,
  { sentence = false }: { sentence?: boolean } = {},
): string {
  const text =
    score === null || score === undefined || !Number.isFinite(score)
      ? NO_SCORE_TEXT
      : `Score ${Math.round(score)}, ${bandInfo(score).label.toLowerCase()}`;
  return sentence ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Said of a contact nobody chose to keep up with. It has no score at all. */
export const NOT_TRACKED_TEXT = "Not tracked";

/**
 * What a surface shows for a contact's score:
 * - `untracked`: no ring, no words, no band. The stored score is a
 *   placeholder.
 * - `unscored`: tracked, nothing logged. The empty track and "No
 *   interactions yet".
 * - `scored`: tracked with a score, clamped to 0 to 100, and its band.
 */
type ScoreView =
  | { kind: "untracked" }
  | { kind: "unscored" }
  | { kind: "scored"; score: number; band: ScoreBandInfo };

export function scoreView(contact: {
  isTracked: boolean;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
}): ScoreView {
  if (!contact.isTracked) return { kind: "untracked" };
  const score = contactScore(contact);
  if (score === null) return { kind: "unscored" };
  return { kind: "scored", score, band: bandInfo(score) };
}

/**
 * The score in words for a view, or null for an untracked contact, whose
 * score a surface leaves out rather than calling it unknown.
 */
export function scoreWords(
  view: ScoreView,
  { sentence = false }: { sentence?: boolean } = {},
): string | null {
  if (view.kind === "untracked") return null;
  return describeScore(view.kind === "scored" ? view.score : null, {
    sentence,
  });
}

/**
 * The score to show, or null. A stored number means nothing when nobody
 * tracks the contact (only tracked contacts are scored) or nothing is logged
 * (the column defaults to 50). Most callers want `scoreView`.
 */
export function contactScore(contact: {
  isTracked: boolean;
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
}): number | null {
  if (!contact.isTracked) return null;
  if (!contact.lastContactedAt) return null;
  const score = contact.relationshipScore;
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(score)));
}
