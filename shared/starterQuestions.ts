/**
 * The starter questions under "Try asking" on Ask Contrack, as
 * `GET /api/search/starters` returns them. The server builds the pool from
 * the account's contacts (`server/services/search/starterQuestions.ts`), and
 * the page shows six of them at random.
 *
 * @module shared/starterQuestions
 */

/**
 * What a question asks about: the contact field its value comes from, or
 * `general` for a question that names no value (`shared/generalQuestions.ts`).
 */
export type StarterKind =
  | "industry"
  | "city"
  | "company"
  | "interest"
  | "role"
  | "pair"
  | "tag"
  | "general";

export interface StarterQuestion {
  /** The question, ready to ask. */
  text: string;
  kind: StarterKind;
}

/** The body of `GET /api/search/starters`. */
export interface StarterQuestionsResponse {
  questions: StarterQuestion[];
}
