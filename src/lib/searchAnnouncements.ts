/**
 * The sentences a search says to a screen reader, through the page's
 * {@link LiveStatus} region. The visible state (a bird, a stage, a count
 * pill) is not announced on its own. A search speaks twice, when it starts
 * and when it finds, and never on every keystroke.
 */
import { plural } from "./utils";

const quoted = (query: string) => `“${query.trim()}”`;

export interface PeopleSearchState {
  /** A question is being answered and nothing is on screen yet. */
  isLoading: boolean;
  /** The search failed. The visible error is an alert, so this says nothing. */
  isError: boolean;
  /** A question has been answered, or asked, since the page was cleared. */
  hasSearched: boolean;
  /** How many people are on screen. */
  count: number;
  /** The question these people answer, or the one being asked. */
  query: string;
  /** AI did not check the results: it is off, or it did not answer. */
  fallback: boolean;
}

/**
 * What the People search should say right now, or "" when nothing changed
 * that a reader needs to hear.
 */
export function peopleSearchStatus(state: PeopleSearchState): string {
  const q = state.query.trim();
  if (!q) return "";
  if (state.isError) return "";
  if (state.isLoading) return `Searching your network for ${quoted(q)}…`;
  if (!state.hasSearched) return "";
  if (state.count === 0) return `No matches for ${quoted(q)}.`;
  return state.fallback
    ? `${plural(state.count, "match", "matches")} for ${quoted(q)}. Not verified by AI.`
    : `${plural(state.count, "match", "matches")} for ${quoted(q)}.`;
}

export interface NoteSearchState {
  /** A request is in flight, including one refining a page already shown. */
  isFetching: boolean;
  /** The server has answered the current question. */
  isSuccess: boolean;
  /** The search failed. The visible error is an alert, so this says nothing. */
  isError: boolean;
  /** Something is being searched for: words, a period, or a kind of note. */
  hasSearch: boolean;
  /** How many notes match in total, across every page. */
  total: number;
  /** The words being searched for, or "" when only a period or kind is set. */
  query: string;
}

/**
 * What the Notes search should say right now, or "" when there is nothing
 * to say.
 */
export function noteSearchStatus(state: NoteSearchState): string {
  if (!state.hasSearch || state.isError) return "";
  if (state.isFetching) return "Searching notes…";
  if (!state.isSuccess) return "";
  const q = state.query.trim();
  const subject = q ? ` for ${quoted(q)}` : " in this period";
  if (state.total === 0) return `No notes match${subject}.`;
  return `${plural(state.total, "note", "notes")}${subject}.`;
}
