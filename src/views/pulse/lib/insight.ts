/**
 * The question the "Ask about this insight" chip asks.
 *
 * An insight is a paragraph. The Ask page takes a question, so the chip
 * sends the insight's first sentence, cut at 120 characters, which is a
 * question a person could have typed.
 *
 * @module views/pulse/lib/insight
 */

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
