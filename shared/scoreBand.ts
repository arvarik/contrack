/**
 * What a relationship score means, in three bands.
 *
 * The server stores a score from 0 to 100 on every contact
 * (`contacts.relationshipScore`, see server/services/relationshipService).
 * A number alone asks the reader to know where "good" starts. The bands give
 * the number a word and a colour, and every place that shows a score reads
 * them here: the ring around an avatar, the list row's accessible name, the
 * command palette, and later the map's health layer and Pulse.
 *
 * | Band      | Score     | Label     | Token     |
 * | --------- | --------- | --------- | --------- |
 * | `strong`  | 70 to 100 | "Strong"  | `success` |
 * | `fading`  | 40 to 69  | "Fading"  | `warning` |
 * | `at-risk` | 0 to 39   | "At risk" | `error`   |
 *
 * The band words mean one thing each. "Slipping" (a contact past its
 * follow-up cadence) and "rising" and "cooling" (score movement) are other
 * facts, and Pulse names them itself.
 *
 * This file imports nothing, so the server and the client both read it.
 *
 * @module shared/scoreBand
 */

export type ScoreBand = "strong" | "fading" | "at-risk";

/** The lowest score in the Strong band. */
export const STRONG_MIN = 70;

/** The lowest score in the Fading band. A score under it is At risk. */
export const FADING_MIN = 40;

export interface ScoreBandInfo {
  band: ScoreBand;
  /** The word shown to a person, in sentence case: "Strong", "At risk". */
  label: string;
  /**
   * The colour token, without its prefix: `success` is `--color-success` in
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
 * The band a score falls in.
 *
 * A score outside 0 to 100 is clamped first, so a stale cache value cannot
 * fall out of every band. A value that is not a number is At risk: the
 * caller that can have no score checks for that before it asks.
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
 * The score in words, for a tooltip or an accessible name.
 *
 * "Score 72, strong", or "No interactions yet" when `score` is null. A caller
 * that puts the text in the middle of a sentence ("Betty Clark, Global
 * Dynamics, score 72, strong") passes `{ sentence: true }` for a lowercase
 * first letter.
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

/**
 * The score to show for a contact, or null when there is none to show.
 *
 * Every contact row carries a score, because the column defaults to 50. A
 * contact with no logged interaction has never been scored against anything,
 * so its 50 is a placeholder and not a judgement. That contact shows no arc
 * and "No interactions yet".
 */
export function contactScore(contact: {
  relationshipScore?: number | null;
  lastContactedAt?: string | null;
}): number | null {
  if (!contact.lastContactedAt) return null;
  const score = contact.relationshipScore;
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(score)));
}
