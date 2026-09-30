// =============================================================================
// Levenshtein & Jaro-Winkler Distances
// =============================================================================

/**
 * Optimal String Alignment (restricted Damerau-Levenshtein) distance.
 * Computes the minimum number of insertions, deletions, substitutions,
 * and adjacent character transpositions.
 *
 * The recurrence reads only the two rows before the current one, so three
 * rows are kept instead of the whole table. Name search scores a few
 * hundred candidates per keystroke, and allocating a table per pair was
 * most of that time.
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let twoAgo = new Array<number>(n + 1).fill(0); // row i - 2
  let oneAgo = new Array<number>(n + 1); // row i - 1
  let current = new Array<number>(n + 1).fill(0); // row i

  for (let j = 0; j <= n; j++) oneAgo[j] = j;

  for (let i = 1; i <= m; i++) {
    current[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        oneAgo[j] + 1, // deletion
        current[j - 1] + 1, // insertion
        oneAgo[j - 1] + cost, // substitution
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoAgo[j - 2] + 1); // transposition
      }
      current[j] = value;
    }
    [twoAgo, oneAgo, current] = [oneAgo, current, twoAgo];
  }

  return oneAgo[n];
}

/**
 * Jaro-Winkler similarity (0→1). Designed specifically for short strings like
 * personal names. Rewards matching prefixes, handles transpositions well.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchWindow = Math.max(
    Math.floor(Math.max(a.length, b.length) / 2) - 1,
    0,
  );
  const aMatches = new Uint8Array(a.length);
  const bMatches = new Uint8Array(b.length);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = 1;
      bMatches[j] = 1;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;

  let prefixLen = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefixLen++;
    else break;
  }

  return jaro + prefixLen * 0.1 * (1 - jaro);
}
