/**
 * How likely a possible duplicate is, in words, never as a percentage: a
 * number reads as more precise than it is, and 85% is the cap for a pair
 * whose first names differ (`REVIEW_CEILING` in
 * server/services/dedupe/policy.ts). A caveat always means "Check carefully".
 */
export type MatchLevel = "very-likely" | "likely" | "check";

/** At or above it, a pair with no caveat is very likely one person. */
const VERY_LIKELY = 0.9;

/** Below it, a pair is a guess: a close name with little else behind it. */
const LIKELY = 0.75;

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

/** The easy decisions first. */
export const LEVEL_ORDER: Record<MatchLevel, number> = {
  "very-likely": 0,
  likely: 1,
  check: 2,
};
