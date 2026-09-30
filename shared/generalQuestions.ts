/**
 * The questions every network can ask, whatever its contacts hold.
 *
 * The starter pool is built from a network's own values: its industries,
 * cities and companies. These do not depend on a value. They ask how long it
 * is since you spoke to someone, who you track, and whose details are old or
 * missing. Each is a fixed question with the facets the app already uses for
 * the same thing, so the answer is the same list the Pulse Inbox and the
 * palette's facet pills open, and the search gives it with no model.
 *
 * Two readers share this table, so a question and its answer cannot drift
 * apart:
 *
 * - The pool (`server/services/search/starterQuestions.ts`) offers a question
 *   only when its facets find somebody in the account.
 * - The search (`server/services/search/implicitFacets.ts`) reads a question
 *   written exactly like one of these as its facets.
 *
 * To add a question, add a row. A row needs text that reads as a question,
 * and facets that are valid in a search request.
 *
 * @module shared/generalQuestions
 */
import type { FacetFilter } from "./searchFacets.ts";

export interface GeneralQuestion {
  /** The question as the page shows it. */
  readonly text: string;
  /** The facets that answer it. The search applies them together. */
  readonly filters: readonly Readonly<FacetFilter>[];
}

const question = (text: string, ...filters: FacetFilter[]): GeneralQuestion =>
  Object.freeze({
    text,
    filters: Object.freeze(filters.map((filter) => Object.freeze(filter))),
  });

export const GENERAL_QUESTIONS: readonly GeneralQuestion[] = Object.freeze([
  // "More than 90 days ago, or never", as `contacted:>90d` reads it.
  question("Who haven't I contacted in over 3 months?", {
    field: "contacted",
    operator: ">",
    value: "90d",
  }),
  question("Who do I track?", { field: "tracked", value: "yes" }),
  question("Who am I not tracking yet?", { field: "tracked", value: "no" }),
  // The Inbox's "contacts have stale data" row opens `updated:>6m`.
  question("Whose details haven't been updated in over 6 months?", {
    field: "updated",
    operator: ">",
    value: "6m",
  }),
  question("Who is missing an email address?", {
    field: "missing",
    value: "email",
  }),
  question("Who is missing a phone number?", {
    field: "missing",
    value: "phone",
  }),
  question("Who is missing a location?", {
    field: "missing",
    value: "location",
  }),
]);

/**
 * A question as a person might type it, reduced to its letters and digits:
 * lower case, apostrophes dropped, every other mark a space, and runs of
 * space as one. "Who haven’t I contacted…?" and "who havent i contacted"
 * are the same question.
 */
export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const BY_TEXT = new Map(
  GENERAL_QUESTIONS.map((entry) => [normalizeQuestion(entry.text), entry]),
);

/**
 * The general question a query is, or null for any other query.
 *
 * The whole query must be the question. "Who haven't I contacted in over 3
 * months in Lisbon?" is not one, and is left to the rest of the search.
 */
export function generalQuestionFor(query: string): GeneralQuestion | null {
  return BY_TEXT.get(normalizeQuestion(query)) ?? null;
}
