// Dedupe scoring: a weighted composite score from independent match signals
// between two NormalizedContacts.
//
// 1. computeMatchSignals()   extract the raw signals from two contacts
// 2. computeCompositeScore() combine them with weights and hard vetoes
// 3. classifyPair()          route to auto-merge, the AI queue, or discard
//
// The weights are tuned for a personal CRM of about 1,000 contacts.

import {
  jaroWinkler,
  isNicknameMatch,
  isSharedMailbox,
} from "../../utils/nlp/index.ts";
import {
  ANCHOR_CONFIDENCE,
  carriersOf,
  generationsContradict,
  namesContradict,
  weaken,
  weighClaim,
} from "./policy.ts";
import type {
  NormalizedContact,
  MatchSignals,
  PairClassification,
  ValueFrequency,
} from "./types.ts";

// Signals

/**
 * Every match signal between two NormalizedContacts. Pure: no database, no side
 * effects; everything must already be in the records.
 *
 * @param a                   - First contact (normalized)
 * @param b                   - Second contact (normalized)
 * @param embeddingSimilarity - Pre-computed cosine similarity (0–1), or 0 if
 *   unavailable
 * @param isKnownDistinct     - Whether this pair is in the negative constraint
 *   set
 * @param socialUrlsA         - Pre-loaded social link URLs for contact A
 * @param socialUrlsB         - Pre-loaded social link URLs for contact B
 * @param frequency           - How widely each value is shared in the account,
 *   from `countValues`. Absent means every shared value is the pair's alone.
 */
export function computeMatchSignals(
  a: NormalizedContact,
  b: NormalizedContact,
  embeddingSimilarity: number,
  isKnownDistinct: boolean,
  socialUrlsA: string[] = [],
  socialUrlsB: string[] = [],
  frequency?: ValueFrequency,
): MatchSignals {
  // Identity anchors. A shared address is an anchor only when it names a
  // person: two contacts on `team.northwind@example.net` are colleagues, and
  // merging them loses one. `isSharedMailbox` splits the cases, and a shared
  // alias scores below as an employer signal instead.
  const sharedEmails = a.emailsNorm.filter((e) => b.emailsNorm.includes(e));
  const personalEmails = sharedEmails.filter((e) => !isSharedMailbox(e));
  const emailOverlap = personalEmails.length > 0;
  const sharedMailboxOverlap = !emailOverlap && sharedEmails.length > 0;

  const sharedPhones = a.phonesNorm.filter((p) => b.phonesNorm.includes(p));
  const phoneOverlap = sharedPhones.length > 0;

  const socialUrlOverlap =
    socialUrlsA.length > 0 &&
    socialUrlsB.length > 0 &&
    socialUrlsA.some((u) => socialUrlsB.includes(u));

  // Name signals. "Robert Hale Sr." and "Robert Hale Jr." normalize to one name
  // and are two people, so a generation conflict is not an exact match. The
  // pair still scores on the similarity below, like any near miss.
  const nameExactMatch =
    a.nameNorm.length > 0 &&
    a.nameNorm === b.nameNorm &&
    !generationsContradict(a, b);

  const nicknameMatch = isNicknameMatch(
    a.nameTokens.join(" "),
    b.nameTokens.join(" "),
  );

  const nameJaroWinkler =
    a.nameNorm.length > 0 && b.nameNorm.length > 0
      ? jaroWinkler(a.nameNorm, b.nameNorm)
      : 0;

  const lastNameExactMatch =
    a.lastNameNorm.length > 1 &&
    b.lastNameNorm.length > 1 &&
    a.lastNameNorm === b.lastNameNorm;

  // The full-name sound is four codes long, so mostly the first name: "Priyanka
  // Narayan" and "Priyanka Desai" both sound PRNK. The last names must agree
  // too, by sound or near spelling, before the pair sounds alike.
  const lastNamesAgree =
    a.lastNameNorm.length > 1 &&
    b.lastNameNorm.length > 1 &&
    ((a.lastNamePhonetic.length > 0 &&
      a.lastNamePhonetic === b.lastNamePhonetic) ||
      jaroWinkler(a.lastNameNorm, b.lastNameNorm) >= 0.8);
  const nameMetaphoneMatch =
    a.phoneticHash.length > 0 &&
    b.phoneticHash.length > 0 &&
    a.phoneticHash === b.phoneticHash &&
    lastNamesAgree;

  // Context signals
  const companyMatch =
    a.companyNorm.length > 1 &&
    b.companyNorm.length > 1 &&
    a.companyNorm === b.companyNorm;

  const companyFuzzy =
    a.companyNorm.length > 1 && b.companyNorm.length > 1
      ? jaroWinkler(a.companyNorm, b.companyNorm)
      : 0;

  // Location: crude city match (first word before comma, or entire string)
  const locA = (a.location ?? "").toLowerCase().split(",")[0].trim();
  const locB = (b.location ?? "").toLowerCase().split(",")[0].trim();
  const locationOverlap = locA.length > 2 && locB.length > 2 && locA === locB;

  // Cross-source: contacts imported from different platforms
  const isCrossSource =
    a.sources.length > 0 &&
    b.sources.length > 0 &&
    !a.sources.some((s) => b.sources.includes(s));

  return {
    emailOverlap,
    sharedMailboxOverlap,
    phoneOverlap,
    socialUrlOverlap,
    nameExactMatch,
    nicknameMatch,
    nameJaroWinkler,
    nameMetaphoneMatch,
    lastNameExactMatch,
    companyMatch,
    companyFuzzy,
    locationOverlap,
    isCrossSource,
    isKnownDistinct,
    embeddingSimilarity,
    namesContradict: namesContradict(a, b),
    emailCarriers: carriersOf(frequency?.emails, personalEmails),
    phoneCarriers: carriersOf(frequency?.phones, sharedPhones),
    nameCarriers: nameExactMatch
      ? carriersOf(frequency?.names, [a.nameNorm])
      : 2,
  };
}

// Composite score

/**
 * A weighted composite score from the match signals:
 * - identity anchors return at once with high confidence
 * - name signals carry the main weight (0.45 to 0.60)
 * - context signals are boosters (0.05 to 0.12)
 * - the embedding adds up to 0.15
 * - known-distinct is a hard veto (0)
 *
 * @returns Score in [0.0, 1.0]
 */
export function computeCompositeScore(signals: MatchSignals): number {
  // Hard veto — physically impossible (co-occurred in same interaction, or user dismissed)
  if (signals.isKnownDistinct) return 0;

  // Identity anchors: near-certain when the pair owns the value and the names
  // agree. The policy weighs down a value three contacts carry, a little per
  // extra carrier, and caps a contradiction ("ada" and "ben") below every
  // auto-merge preset.
  if (signals.emailOverlap) {
    return weighClaim(
      ANCHOR_CONFIDENCE.email,
      signals.emailCarriers,
      signals.namesContradict,
    );
  }
  if (signals.phoneOverlap) {
    return weighClaim(
      ANCHOR_CONFIDENCE.phone,
      signals.phoneCarriers,
      signals.namesContradict,
    );
  }
  if (signals.socialUrlOverlap) {
    return weighClaim(ANCHOR_CONFIDENCE.social, 2, signals.namesContradict);
  }

  // With no shared identifier, two different first names are two people: pairs
  // like "Josh Marlow" and "Sam Marlow" at one company always turned out to be.
  if (signals.namesContradict) return 0;

  let score = 0;

  // Name signals (primary weight)
  if (signals.nameExactMatch) {
    // A common name is worth less. Same rule as the anchors, applied to the
    // weight rather than to the whole score.
    score += weaken(0.6, signals.nameCarriers, false);
  } else if (signals.nicknameMatch && signals.lastNameExactMatch) {
    score += 0.55;
  } else {
    score += signals.nameJaroWinkler * 0.45;
  }

  if (signals.nameMetaphoneMatch) score += 0.08;

  // Context boosters. A shared mailbox claims what a matching company claims,
  // so it earns the same booster, once.
  if (signals.companyMatch || signals.sharedMailboxOverlap) {
    score += 0.12;
  } else if (signals.companyFuzzy > 0.7) {
    score += 0.08;
  }

  if (signals.locationOverlap) score += 0.05;
  if (signals.isCrossSource) score += 0.08;

  // Embedding signal (if available)
  if (signals.embeddingSimilarity > 0) {
    score += signals.embeddingSimilarity * 0.15;
  }

  return Math.min(1.0, score);
}

// Pair classification

/**
 * Score thresholds for routing a pair, exported so
 * `tests/eval/dedupe.eval.test.ts` pins them: moving either changes which pairs
 * reach a person and which merge without asking.
 */
export const THRESHOLD_AUTO = 0.93; // ≥ 0.93 → auto-merge quality (or send straight to cluster)
export const THRESHOLD_AI = 0.6; // 0.60–0.93 → needs AI verification
// < 0.60 → discard (too different)

/**
 * Classify a pair by its composite score:
 * - "auto":    score ≥ 0.93, high confidence, sent to the cluster as
 *   "deterministic"
 * - "ai":      0.60 ≤ score < 0.93, ambiguous, sent to the model
 * - "discard": score < 0.60, too different to spend tokens on
 */
export function classifyPair(score: number): PairClassification {
  if (score >= THRESHOLD_AUTO) return "auto";
  if (score >= THRESHOLD_AI) return "ai";
  return "discard";
}

/** The least an unclear pair must score to be kept when no model checks it. */
export const UNVERIFIED_FLOOR = 0.75;

/** What an unclear pair keeps of its score when no model checks it. */
export const UNVERIFIED_WEIGHT = 0.7;

/**
 * A funnel pair's confidence when no model checks it, or null to drop it. A
 * scan without a provider, the check after an import and the check after a
 * contact is added all score pairs with nobody to ask. A pair in the auto band
 * keeps its score. An unclear pair is kept only from 0.75, at 0.7 of its score,
 * so it waits for a person below every preset. Kept at full score from 0.60, a
 * LinkedIn import would fill the review list with people who only share an
 * employer.
 */
export function unverifiedConfidence(score: number): number | null {
  const classification = classifyPair(score);
  if (classification === "auto") return score;
  if (classification === "ai" && score >= UNVERIFIED_FLOOR) {
    return score * UNVERIFIED_WEIGHT;
  }
  return null;
}

/**
 * Convert sqlite-vec's L2 distance to a 0 to 1 similarity. For L2-normalized
 * vectors, cosine_sim = 1 - (L2_dist² / 2).
 */
export function distanceToSimilarity(distance: number): number {
  // Clamp to [0, 2] range for normalized vectors
  const d = Math.max(0, Math.min(2, distance));
  return 1 - (d * d) / 2;
}
