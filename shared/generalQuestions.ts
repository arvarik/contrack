/**
 * The questions every network can ask, whatever its contacts hold.
 *
 * The starter pool is built from a network's own values: its industries,
 * cities and companies. These name no value. They ask how long it is since
 * you spoke to someone, who you track, and whose details are old or missing.
 * Each is written beside its facets, in the words the Pulse Inbox links use
 * (`/?q=updated:>6m`), so the answer is the same list, and the search gives
 * it with no model.
 *
 * Two readers share this table, so a question and its answer cannot drift
 * apart:
 *
 * - The pool (`server/services/search/starterQuestions.ts`) offers a question
 *   only when its facets find somebody in the account.
 * - The search (`server/services/search/implicitFacets.ts`) reads a question
 *   written exactly like one of these as its facets.
 *
 * To add a question, add a row.
 *
 * @module shared/generalQuestions
 */
import { parseFacetQuery } from "./facetQuery.ts";
import type { FacetFilter } from "./searchFacets.ts";

export interface GeneralQuestion {
  /** The question as the page shows it. */
  readonly text: string;
  /** Its facets as a person types them, for a link to the Network list. */
  readonly facets: string;
  /** The facets that answer it. The search applies them together. */
  readonly filters: readonly FacetFilter[];
}

export const GENERAL_QUESTIONS: readonly GeneralQuestion[] = (
  [
    // `contacted:>90d` is more than 90 days ago, or never.
    ["Who haven't I contacted in over 3 months?", "contacted:>90d"],
    ["Who do I track?", "tracked:yes"],
    ["Who am I not tracking yet?", "tracked:no"],
    ["Whose details haven't been updated in over 6 months?", "updated:>6m"],
    ["Who is missing an email address?", "missing:email"],
    ["Who is missing a phone number?", "missing:phone"],
    ["Who is missing a location?", "missing:location"],
  ] as const
).map(([text, facets]) => ({
  text,
  facets,
  filters: parseFacetQuery(facets).filters,
}));

/**
 * A question as a person might type it, reduced to its letters and digits:
 * lower case, apostrophes dropped, every other mark a space. "Who haven’t I
 * contacted…?" and "who havent i contacted" are the same question.
 */
const normalize = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const BY_TEXT = new Map(GENERAL_QUESTIONS.map((q) => [normalize(q.text), q]));

/**
 * The general question a query is, or null for any other query.
 *
 * The whole query must be the question. "Who haven't I contacted in over 3
 * months in Lisbon?" is not one, and is left to the rest of the search.
 */
export function generalQuestionFor(query: string): GeneralQuestion | null {
  return BY_TEXT.get(normalize(query)) ?? null;
}
