/**
 * How likely a possible duplicate is, in the words the review screens show.
 *
 * The engine scores a pair from 0 to 1, and the screens used to print the
 * number: "Phone match · 85%". A percentage reads as more precise than it
 * is, and 85% looked strong on the one pair the engine wanted a person to
 * check: 85% is the cap it gives a pair whose first names differ
 * (`REVIEW_CEILING` in server/services/dedupe/policy.ts). So the screens
 * show one of three words, and the engine's caveat, when it has one, always
 * makes the pair "Check carefully".
 *
 * @module views/dedupe/utils/level
 */
export type MatchLevel = "very-likely" | "likely" | "check";

/** At or above it, a pair with no caveat is very likely one person. */
const VERY_LIKELY = 0.9;

/** Below it, a pair is a guess: a close name with little else behind it. */
const LIKELY = 0.75;

/** The level of one pair, or of a group's strongest pair. */
export function matchLevel(
  confidence: number,
  caveat: string | null | undefined,
): MatchLevel {
  if (caveat) return "check";
  if (confidence >= VERY_LIKELY) return "very-likely";
  if (confidence >= LIKELY) return "likely";
  return "check";
}

export const LEVEL_LABEL: Record<MatchLevel, string> = {
  "very-likely": "Very likely",
  likely: "Likely",
  check: "Check carefully",
};

/**
 * Each level's tone, from the one map in `lib/styles`: green for a strong
 * match, the warning amber for a pair to look at twice, and nothing for the
 * middle, which is most of them.
 */
export const LEVEL_TONE: Record<MatchLevel, "success" | "neutral" | "warning"> =
  {
    "very-likely": "success",
    likely: "neutral",
    check: "warning",
  };

/** The order a review list shows its levels in: the easy decisions first. */
export const LEVEL_ORDER: Record<MatchLevel, number> = {
  "very-likely": 0,
  likely: 1,
  check: 2,
};
