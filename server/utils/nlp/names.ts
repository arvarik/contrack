// =============================================================================
// Name Tokenization & Similarity
// =============================================================================

import { jaroWinkler, damerauLevenshtein } from "./distances.ts";
import { areNicknameEquivalent } from "./nicknames.ts";
import { doubleMetaphone } from "./phonetics.ts";

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

/**
 * Generational suffixes, each spelling mapped to one canonical form.
 *
 * `tokenizeName` strips these, which is right for matching "Robert Hale Jr."
 * against "Robert Hale". It is wrong for "Robert Hale Sr." against "Robert
 * Hale Jr.", which the stripped tokens make identical and which are two
 * people by definition. This reads the suffix before it is stripped.
 */
const GENERATIONS: Record<string, string> = {
  jr: "jr",
  junior: "jr",
  sr: "sr",
  senior: "sr",
  ii: "ii",
  "2nd": "ii",
  iii: "iii",
  "3rd": "iii",
  iv: "iv",
  "4th": "iv",
};

/**
 * The generational suffix a raw name carries, or null.
 *
 * "Robert Hale Jr." → "jr", "Robert Hale III" → "iii", "Robert Hale" → null.
 * Only a trailing token counts, so a surname that happens to spell one of
 * these is not read as a suffix.
 */
export function generationOf(name: string): string | null {
  const tokens = name
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length < 2) return null;
  return GENERATIONS[tokens[tokens.length - 1]] ?? null;
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

  const dmA = doubleMetaphone(a);
  const dmB = doubleMetaphone(b);
  const phoneticMatch = Boolean(
    (dmA.primary &&
      (dmA.primary === dmB.primary || dmA.primary === dmB.alternate)) ||
    (dmA.alternate &&
      (dmA.alternate === dmB.primary || dmA.alternate === dmB.alternate)),
  );

  const dist = damerauLevenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const minLen = Math.min(a.length, b.length);

  // If phonetically equivalent, reward with high score
  if (phoneticMatch) {
    const jw = jaroWinkler(a, b);
    return Math.max(jw, 0.88);
  }

  // Without phonetic equivalence, two tokens with > 2 edits are not typos.
  // Also require distance to be at most half of the shorter word.
  if (dist > 2 || dist > Math.ceil(minLen / 2)) {
    return 0;
  }

  const dl = maxLen > 0 ? 1 - dist / maxLen : 0;
  const jw = jaroWinkler(a, b);
  return Math.max(jw, dl);
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

  // Full-string similarity only applies when both have the same token structure
  // (e.g. both single words or both full names) to avoid a short token
  // artificially matching a substring across full names.
  if (tokA.length === tokB.length) {
    const fullJW = jaroWinkler(la, lb);
    const maxLen = Math.max(la.length, lb.length);
    const fullDL = maxLen > 0 ? 1 - damerauLevenshtein(la, lb) / maxLen : 0;
    return Math.max(tokenScore, fullJW, fullDL);
  }

  return tokenScore;
}
