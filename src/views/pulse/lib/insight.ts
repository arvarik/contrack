/**
 * The question the "Ask about this insight" chip asks, and the insight's
 * category in the app's sentence case.
 *
 * An insight is a paragraph. The Ask page takes a question, so the chip
 * sends the insight's first sentence, cut at 120 characters, which is a
 * question a person could have typed.
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

/** The longest question the chip sends. */
export const INSIGHT_QUESTION_MAX = 120;

/**
 * The text up to its first period, cut at `max` characters. A cut at a word
 * boundary when one is near, so the question never ends mid-word.
 */
export function firstSentence(
  text: string,
  max: number = INSIGHT_QUESTION_MAX,
): string {
  const trimmed = text.trim();
  const period = trimmed.indexOf(".");
  let sentence = period === -1 ? trimmed : trimmed.slice(0, period);
  if (sentence.length > max) {
    const cut = sentence.slice(0, max);
    const space = cut.lastIndexOf(" ");
    sentence = (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
  }
  return sentence;
}
