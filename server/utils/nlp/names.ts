// =============================================================================
// Name Tokenization & Similarity
// =============================================================================

import { jaroWinkler } from "./distances.ts";
import { areNicknameEquivalent } from "./nicknames.ts";

/** Titles and suffixes to strip from name tokens before comparison */
const TITLE_SUFFIXES = new Set([
  "dr",
  "dr.",
  "mr",
  "mr.",
  "mrs",
  "mrs.",
  "ms",
  "ms.",
  "prof",
  "prof.",
  "sir",
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
  "phd",
  "md",
  "esq",
  "cpa",
  "dds",
  "dvm",
]);

/**
 * Tokenize and clean a name: lowercase, strip titles/suffixes, remove punctuation.
 * "Dr. Sarah Chen III" → ["sarah", "chen"]
 */
export function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.\\-]+|[.\\-]+$/g, ""))
    .filter(
      (t) =>
        t.length > 0 && !TITLE_SUFFIXES.has(t) && !TITLE_SUFFIXES.has(t + "."),
    );
}

function asInitial(token: string): string | null {
  if (token.length === 1 && /[a-z]/.test(token)) return token;
  if (token.length === 2 && token[1] === "." && /[a-z]/.test(token[0]))
    return token[0];
  return null;
}

function tokenSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  if (tokensA.length === 1 && tokensB.length === 1) {
    return singleTokenScore(tokensA[0], tokensB[0]);
  }

  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  const used = new Set<number>();
  let totalScore = 0;

  for (const sToken of shorter) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let li = 0; li < longer.length; li++) {
      if (used.has(li)) continue;
      const score = singleTokenScore(sToken, longer[li]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = li;
      }
    }
    if (bestIdx >= 0) used.add(bestIdx);
    totalScore += bestScore;
  }

  const unmatchedPenalty = (longer.length - shorter.length) * 0.05;
  const rawScore = totalScore / shorter.length;

  return Math.max(0, Math.min(1, rawScore - unmatchedPenalty));
}

function singleTokenScore(a: string, b: string): number {
  if (a === b) return 1.0;

  if (areNicknameEquivalent(a, b)) return 0.95;

  const initA = asInitial(a);
  const initB = asInitial(b);
  if (initA && b.startsWith(initA)) return 0.85;
  if (initB && a.startsWith(initB)) return 0.85;

  return jaroWinkler(a, b);
}

/**
 * Production-grade name similarity — multi-signal comparator.
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;

  const tokA = tokenizeName(a);
  const tokB = tokenizeName(b);

  const tokenScore = tokenSimilarity(tokA, tokB);
  const fullJW = jaroWinkler(la, lb);

  return Math.max(tokenScore, fullJW);
}
