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
 * A score exists only for a contact somebody tracks. `scoreView` is the one
 * reader every surface asks, and it answers in three states: `untracked`,
 * `unscored` and `scored`. Nothing on the client reads
 * `contacts.relationshipScore` without going through it.
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

/** Said of a contact nobody chose to keep up with. It has no score at all. */
export const NOT_TRACKED_TEXT = "Not tracked";

/**
 * What a surface shows for a contact's score, in three states.
 *
 * - `untracked`: nobody chose to keep up with this contact. No ring, no
 *   words, no band. The stored score is a placeholder.
 * - `unscored`: tracked, but no interaction logged yet. The empty track and
 *   "No interactions yet".
 * - `scored`: tracked with a score, clamped to 0 to 100, and its band.
 *
 * Every reader of the score on the client goes through this, so the ring, the
 * palette, the map and Pulse can never disagree about who has a score.
 */
export type ScoreView =
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
 * The score in words for a view, or null when there is nothing to say.
 *
 * A surface that names a contact ("Betty Clark, Global Dynamics, score 72,
 * strong") calls this and leaves the part out when it is null. Nobody tracks
 * an untracked contact, so the surface says nothing about its score rather
 * than calling it unknown.
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
 * The score to show for a contact, or null when there is none to show.
 *
 * Two facts make a stored number mean nothing:
 *
 * 1. Nobody tracks this contact. The score is only computed for a contact a
 *    person chose to keep up with, so the column holds whatever it held
 *    before, or the default.
 * 2. Nothing is logged yet. The column defaults to 50, and 50 against no
 *    interaction is a placeholder, not a judgement.
 *
 * Most callers want `scoreView`, which names the two cases apart. This
 * function answers the number alone.
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
