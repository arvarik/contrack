/**
 * The insight's category in the app's sentence case.
 *
 * @module views/pulse/lib/insight
 */

/**
 * A model's category in sentence case. The model writes Title Case
 * ("Relationship Maintenance"), and every string the app shows is sentence
 * case. The first word keeps its capital. A later word keeps its spelling
 * only when it has a capital after its first letter, an acronym such as
 * "AI" or a name such as "LinkedIn", and is lower case otherwise. Each part
 * of a hyphenated word counts as a word, so "Follow-Up Strategy" reads
 * "Follow-up strategy" and "AI-Powered" reads "AI-powered".
 */
export function sentenceCase(text: string): string {
  const part = (piece: string, first: boolean) => {
    if (first) return piece.charAt(0).toUpperCase() + piece.slice(1);
    return /[A-Z]/.test(piece.slice(1)) ? piece : piece.toLowerCase();
  };
  return text
    .trim()
    .split(/\s+/)
    .map((word, i) =>
      word
        .split("-")
        .map((piece, j) => part(piece, i === 0 && j === 0))
        .join("-"),
    )
    .join(" ");
}
