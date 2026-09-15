/**
 * searchAnnouncements.ts — the sentences a search says to a screen reader.
 *
 * The search page shows its state in three places at once: a spinner in the
 * input, a "Searching…" line over the shimmer, and a count pill over the
 * results. None of those is announced, because none of them is a status
 * message: they mount with their text, they are icons, or they are the
 * fiftieth element on the page. These builders turn the same state into one
 * sentence for the page's {@link LiveStatus} region.
 *
 * Pure functions, so the wording is tested without a DOM. The rule for each:
 * say what the reader would otherwise have to find, and no more. A search
 * speaks at most three times — that it started, that keyword candidates
 * arrived while AI is still working, and what it found — and never on every
 * keystroke.
 *
 * @module lib/searchAnnouncements
 */

/** "1 match" / "3 matches". */
export function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const quoted = (query: string) => `“${query.trim()}”`;

export interface PeopleSearchState {
  /** A question is being answered and nothing is on screen yet. */
  isLoading: boolean;
  /** Keyword candidates are on screen while AI still refines them. */
  isEnriching: boolean;
  /** The search failed. The visible error is an alert, so this says nothing. */
  isError: boolean;
  /** A question has been answered, or asked, since the page was cleared. */
  hasSearched: boolean;
  /** How many people are on screen. */
  count: number;
  /** The question these people answer, or the one being asked. */
  query: string;
  /** AI was unavailable and the results are keyword matches. */
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
  if (state.isEnriching)
    return `${plural(state.count, "keyword candidate", "keyword candidates")} for ${quoted(q)}. Enriching with AI…`;
  if (!state.hasSearched) return "";
  if (state.count === 0) return `No matches for ${quoted(q)}.`;
  const matches = plural(state.count, "match", "matches");
  return state.fallback
    ? `AI unavailable. ${matches} for ${quoted(q)} by keyword.`
    : `${matches} for ${quoted(q)}.`;
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
