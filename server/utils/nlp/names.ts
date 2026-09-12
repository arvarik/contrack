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
 * Fold accents onto the base letter: "García" → "Garcia", "Søren" → "Soren".
 *
 * NFD splits an accented character into its base letter and a combining mark,
 * and the range below is those marks. Without this, the `[^\w\s'-]` class
 * further down treated every accent as punctuation and replaced it with a
 * space, so "María García" tokenized to ["mar", "a", "garc", "a"] — four
 * fragments, a surname of "a", and a blocking key nothing else could match.
 *
 * Two of the three letters that do not decompose are handled by hand. "ø" and
 * "ł" carry their stroke inside the code point rather than as a combining
 * mark, so NFD leaves them alone and `\w` then drops them.
 */
function foldDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe");
}

/**
 * Tokenize and clean a name: lowercase, fold accents, strip titles/suffixes,
 * remove punctuation.
 * "Dr. Sarah Chen III" → ["sarah", "chen"]
 * "María García"       → ["maria", "garcia"]
 */
export function tokenizeName(name: string): string[] {
  return foldDiacritics(name.toLowerCase())
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
 * Whether one name is the other with middle names added.
 *
 * "Anton Kovacs" and "Anton Peter Kovacs" are one person written down twice.
 * Jaro-Winkler on the joined strings scores that pair 0.879 to 0.955, which
 * lands it between the discard and the auto thresholds, so with no AI provider
 * configured the engine found 0 of 15 such pairs in the eval corpus. The shape
 * is exact, so it is worth testing for exactly rather than approximating with
 * a distance.
 *
 * Three conditions, and each one refuses a pair that the subsequence test
 * alone would accept:
 *
 * 1. The first tokens agree. "Peter Kovacs" inside "Anton Peter Kovacs" is
 *    somebody going by their middle name, or somebody else entirely.
 * 2. The last tokens agree. A shared surname is the anchor.
 * 3. The shorter name's tokens appear in the longer one in order, and the
 *    longer one is strictly longer. "Robert Lee Smith" against "Robert Ann
 *    Smith" is two people, and equal lengths refuse it.
 *
 * A one-token name never qualifies: "Kovacs" is not evidence of anything.
 *
 * @param a - Tokens of the first name, from {@link tokenizeName}.
 * @param b - Tokens of the second name, from {@link tokenizeName}.
 * @returns True when the two differ only by added middle names.
 */
export function isMiddleNameExtension(a: string[], b: string[]): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2 || longer.length <= shorter.length) return false;
  if (shorter[0] !== longer[0]) return false;
  if (shorter[shorter.length - 1] !== longer[longer.length - 1]) return false;

  let at = 0;
  for (const token of shorter) {
    at = longer.indexOf(token, at);
    if (at === -1) return false;
    at++;
  }
  return true;
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
