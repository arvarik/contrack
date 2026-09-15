// =============================================================================
// Interaction query — from a question to an FTS5 MATCH expression
// =============================================================================
// A person types "who discussed hiring", not "hiring". The words that make a
// question a question carry nothing a note could match on, so they are set
// aside before the rest go to the index. The words that are left are matched
// two ways: all of them, then, when nothing has all of them, any of them,
// ranked so that a note with more of them comes first.
// =============================================================================

import { searchTokens } from "./lexical.ts";

/**
 * Words that shape a question and say nothing about a note.
 *
 * Function words, question words, and the verbs a person uses to ask what
 * was said. "meeting", "call" and "email" are not here: they name kinds of
 * note, and a note can be about one.
 */
export const QUESTION_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "at",
  "with",
  "about",
  "for",
  "from",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "i",
  "me",
  "my",
  "we",
  "our",
  "us",
  "you",
  "your",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "there",
  "who",
  "whom",
  "whose",
  "what",
  "which",
  "when",
  "where",
  "why",
  "how",
  "any",
  "anyone",
  "anybody",
  "someone",
  "somebody",
  "people",
  "person",
  "contact",
  "contacts",
  "note",
  "notes",
  "discuss",
  "discussed",
  "discussing",
  "talk",
  "talked",
  "talking",
  "speak",
  "spoke",
  "spoken",
  "speaking",
  "say",
  "said",
  "mention",
  "mentioned",
  "chat",
  "chatted",
  "conversation",
  "conversations",
]);

/** How the words are combined. `none` means there is nothing to match. */
export type MatchMode = "all" | "any" | "none";

export interface InteractionMatch {
  /** The words that reach the index, in query order. */
  tokens: string[];
  /** `... AND ...` over every token, or null when there are no tokens. */
  strict: string | null;
  /** `... OR ...` over every token, or null with fewer than two tokens. */
  loose: string | null;
}

/**
 * A token as an FTS5 term. Longer tokens are prefixes, because the page
 * searches as the person types. A one-letter token is an exact term: "a*"
 * would match most of the index.
 */
function term(token: string): string {
  return token.length > 1 ? `"${token}"*` : `"${token}"`;
}

/**
 * Compile the free text of a query.
 *
 * @param text - The query after any date phrase has been lifted out.
 * @param keepQuestionWords - Search for every word, including the question
 *   words. Used when dropping them would leave nothing to search for and
 *   there is no date filter either, so a best effort beats an empty page.
 */
export function compileInteractionMatch(
  text: string,
  keepQuestionWords = false,
): InteractionMatch {
  const all = searchTokens(text);
  const tokens = keepQuestionWords
    ? all
    : all.filter((token) => !QUESTION_WORDS.has(token.toLowerCase()));
  if (!tokens.length) return { tokens: [], strict: null, loose: null };
  const terms = tokens.map(term);
  return {
    tokens,
    strict: terms.join(" AND "),
    loose: terms.length > 1 ? terms.join(" OR ") : null,
  };
}
