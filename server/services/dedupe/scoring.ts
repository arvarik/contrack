// =============================================================================
// Dedupe Scoring Engine — Multi-Signal Composite Contact Scoring
// =============================================================================
// Computes a weighted composite score from multiple independent match signals
// between two NormalizedContacts. This replaces the old single-dimension
// `nameSimilarity` check with a proper multi-signal scoring model.
//
// Architecture:
// 1. computeMatchSignals()   — extract raw signals from two contacts
// 2. computeCompositeScore() — weighted combination with hard vetoes
// 3. classifyPair()          — route to auto-merge, AI queue, or discard
//
// The scoring weights are calibrated per the DEDUPE_STRATEGIES.md spec
// (Section 2.7) and tuned for a personal CRM with ~1,000 contacts.
// =============================================================================

import { jaroWinkler, isNicknameMatch } from "../../utils/nlp/index.ts";
import type {
  NormalizedContact,
  MatchSignals,
  PairClassification,
} from "./types.ts";

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Signal Computation
// =============================================================================

/**
 * Compute all match signals between two NormalizedContacts.
 *
 * This is a **pure function** — no database access, no side effects.
 * All data must be pre-loaded into the NormalizedContact structures.
 *
 * @param a                   - First contact (normalized)
 * @param b                   - Second contact (normalized)
 * @param embeddingSimilarity - Pre-computed cosine similarity (0–1), or 0 if unavailable
 * @param isKnownDistinct     - Whether this pair is in the negative constraint set
 * @param socialUrlsA         - Pre-loaded social link URLs for contact A
 * @param socialUrlsB         - Pre-loaded social link URLs for contact B
 */
export function computeMatchSignals(
  a: NormalizedContact,
  b: NormalizedContact,
  embeddingSimilarity: number,
  isKnownDistinct: boolean,
  socialUrlsA: string[] = [],
  socialUrlsB: string[] = [],
): MatchSignals {
  // --- Identity anchors ---
  const emailOverlap =
    a.emailsNorm.length > 0 &&
    b.emailsNorm.length > 0 &&
    a.emailsNorm.some((e) => b.emailsNorm.includes(e));

  const phoneOverlap =
    a.phonesNorm.length > 0 &&
    b.phonesNorm.length > 0 &&
    a.phonesNorm.some((p) => b.phonesNorm.includes(p));

  const socialUrlOverlap =
    socialUrlsA.length > 0 &&
    socialUrlsB.length > 0 &&
    socialUrlsA.some((u) => socialUrlsB.includes(u));

  // --- Name signals ---
  const nameExactMatch = a.nameNorm.length > 0 && a.nameNorm === b.nameNorm;

  const nicknameMatch = isNicknameMatch(
    a.nameTokens.join(" "),
    b.nameTokens.join(" "),
  );

  const nameJaroWinkler =
    a.nameNorm.length > 0 && b.nameNorm.length > 0
      ? jaroWinkler(a.nameNorm, b.nameNorm)
      : 0;

  const nameMetaphoneMatch =
    a.phoneticHash.length > 0 &&
    b.phoneticHash.length > 0 &&
    a.phoneticHash === b.phoneticHash;

  const lastNameExactMatch =
    a.lastNameNorm.length > 1 &&
    b.lastNameNorm.length > 1 &&
    a.lastNameNorm === b.lastNameNorm;

  // --- Context signals ---
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
  };
}

// =============================================================================
// Composite Score
// =============================================================================

/**
 * Compute a weighted composite score from match signals.
 *
 * Scoring weights calibrated per DEDUPE_STRATEGIES.md Section 2.7:
 * - Identity anchors are immediate high-confidence returns
 * - Name signals carry primary weight (0.45–0.60)
 * - Context signals are boosters (0.05–0.12)
 * - Embedding adds up to 0.15 additional signal
 * - Known-distinct is a hard veto (returns 0)
 *
 * @returns Score in [0.0, 1.0]
 */
export function computeCompositeScore(signals: MatchSignals): number {
  // Hard veto — physically impossible (co-occurred in same interaction, or user dismissed)
  if (signals.isKnownDistinct) return 0;

  // Identity anchors — near-certain, return immediately
  if (signals.emailOverlap) return 0.98;
  if (signals.phoneOverlap) return 0.95;
  if (signals.socialUrlOverlap) return 0.93;

  let score = 0;

  // --- Name signals (primary weight) ---
  if (signals.nameExactMatch) {
    score += 0.6;
  } else if (signals.nicknameMatch && signals.lastNameExactMatch) {
    score += 0.55;
  } else {
    score += signals.nameJaroWinkler * 0.45;
  }

  if (signals.nameMetaphoneMatch) score += 0.08;

  // --- Context boosters ---
  if (signals.companyMatch) {
    score += 0.12;
  } else if (signals.companyFuzzy > 0.7) {
    score += 0.08;
  }

  if (signals.locationOverlap) score += 0.05;
  if (signals.isCrossSource) score += 0.08;

  // --- Embedding signal (if available) ---
  if (signals.embeddingSimilarity > 0) {
    score += signals.embeddingSimilarity * 0.15;
  }

  return Math.min(1.0, score);
}

// =============================================================================
// Pair Classification
// =============================================================================

/** Score thresholds for pair routing. */
const THRESHOLD_AUTO = 0.93; // ≥ 0.93 → auto-merge quality (or send straight to cluster)
const THRESHOLD_AI = 0.6; // 0.60–0.93 → needs AI verification
// < 0.60 → discard (too different)

/**
 * Classify a pair based on its composite score.
 *
 * - "auto":    score ≥ 0.93 — high enough confidence. For now, we still send
 *              these to the cluster as "deterministic" quality. In Phase 4 these
 *              become candidates for background auto-merge.
 * - "ai":      0.60 ≤ score < 0.93 — genuinely ambiguous, send to AI
 * - "discard": score < 0.60 — too different, not worth AI tokens
 */
export function classifyPair(score: number): PairClassification {
  if (score >= THRESHOLD_AUTO) return "auto";
  if (score >= THRESHOLD_AI) return "ai";
  return "discard";
}

/**
 * Convert embedding L2 distance (from sqlite-vec) to a 0–1 similarity score.
 * sqlite-vec returns L2 distance for FLOAT vectors: lower = more similar.
 *
 * For L2-normalized vectors (which ours are), L2² distance and cosine similarity
 * are related: cosine_sim = 1 - (L2_dist² / 2).
 */
export function distanceToSimilarity(distance: number): number {
  // Clamp to [0, 2] range for normalized vectors
  const d = Math.max(0, Math.min(2, distance));
  return 1 - (d * d) / 2;
}
