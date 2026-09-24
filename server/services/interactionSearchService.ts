// =============================================================================
// Interaction search — "who discussed hiring last month?" answered locally
// =============================================================================
// One statement over interactions_fts, joined to the interaction and the
// contact it belongs to. The owner is in the MATCH expression, on the
// interaction row and on the contact row, and the contact has to be active,
// so a note on a trashed or merged contact is not an answer.
//
// Nothing here calls a model. The date phrase parser, the question-word
// filter and FTS5 are all the intelligence there is, which is what makes an
// answer from this service reproducible: the same notes and the same question
// give the same page.
// =============================================================================

import type Database from "better-sqlite3";
import { sqlite } from "../db.ts";
import { ACTIVE_CONTACT_SQL } from "./search/ftsIndex.ts";
import { scopedMatch } from "./search/lexical.ts";
import {
  INTERACTION_FTS_CONTENT_COLUMN,
  INTERACTION_FTS_TITLE_COLUMN,
  INTERACTION_WEIGHTS,
} from "./search/interactionFtsIndex.ts";
import {
  boundFromFilter,
  extractDatePhrase,
  isValidTimeZone,
} from "./search/datePhrases.ts";
import {
  compileInteractionMatch,
  type MatchMode,
} from "./search/interactionQuery.ts";
import type { Scope } from "../tenancy/scope.ts";

// =============================================================================
// Types
// =============================================================================

export interface InteractionSearchParams {
  /** Free text. A date phrase inside it is lifted out and applied as a filter. */
  q?: string;
  /** A calendar date (a whole day in `timeZone`) or an instant, inclusive. */
  from?: string;
  /** A calendar date (a whole day in `timeZone`) or an instant, exclusive. */
  to?: string;
  /** Exact interaction type, for example `note` or `call`. */
  type?: string;
  /** Notes on one contact only. */
  contactId?: string;
  sort?: "relevance" | "date";
  /** `auto` tries every word first and falls back to any word. */
  mode?: "auto" | "all" | "any";
  limit?: number;
  offset?: number;
  /** The caller's IANA zone. Unknown or absent means UTC. */
  timeZone?: string;
  /** The moment "today" is measured from. Tests pin it. */
  now?: Date;
}

/** Start and end offsets of a matched term, in UTF-16 code units. */
export type HighlightRange = [number, number];

export interface InteractionSearchHit {
  /** The interaction id. */
  id: string;
  contactId: string;
  type: string;
  title: string;
  /** The interaction date exactly as stored. */
  date: string;
  /** The best passage of the body, or its opening when nothing matched there. */
  excerpt: string | null;
  highlights: { title: HighlightRange[]; excerpt: HighlightRange[] };
  contact: {
    id: string;
    name: string;
    avatarUrl: string | null;
    themeColor: string | null;
    company: string | null;
    role: string | null;
  };
}

export interface AppliedRange {
  /** ISO instant, inclusive. Null when the range is open at this end. */
  from: string | null;
  /** ISO instant, exclusive. Null when the range is open at this end. */
  to: string | null;
  /** Whether the caller gave the range or the question named it. */
  source: "filter" | "phrase";
}

export interface InteractionSearchResult {
  query: {
    /** The words that went to the index, after the date phrase came out. */
    text: string;
    tokens: string[];
    mode: MatchMode;
    /** The words read as a period, when the question named one. */
    phrase: string | null;
    range: AppliedRange | null;
    timeZone: string;
  };
  total: number;
  limit: number;
  offset: number;
  hits: InteractionSearchHit[];
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_OFFSET = 5000;

/** Tokens of body text a snippet may hold. FTS5 caps this at 64. */
const SNIPPET_TOKENS = 24;

/** Characters of body text shown when nothing in the body matched. */
const OPENING_LENGTH = 240;

/**
 * `interactions.date` holds three shapes: SQLite's `2026-09-10 06:14:30`,
 * JavaScript's `2026-09-10T06:14:30.000Z`, and a bare `2026-09-10`. As text
 * they do not compare across shapes, because a space sorts before a `T`.
 * strftime reads all three and writes one, so a bound in ISO form compares
 * correctly against every row.
 */
const INSTANT_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', i.date)";

/**
 * The highlight markers. Two control characters that `notePlainText` strips
 * on the way into the index, so a note cannot contain one, so a marker in
 * the output is always ours.
 */
const OPEN = "\u0001";
const CLOSE = "\u0002";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Compiled statements, by their SQL. The SQL changes only with which
 * filters are set and with the order, so the cache holds a few dozen at
 * most, and a search compiles nothing after its first run.
 */
const statements = new Map<string, Database.Statement>();

function prepare(sql: string): Database.Statement {
  let statement = statements.get(sql);
  if (!statement) {
    statement = sqlite.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

/**
 * The body text a hit reads when nothing in the body matched: its opening,
 * one character past what `opening` shows, so it can tell a longer body
 * and add the ellipsis. A long email's whole body used to come back for
 * every hit on its title.
 */
const OPENING_SQL = `substr(f.content, 1, ${OPENING_LENGTH + 1})`;

interface RawHit {
  id: string;
  contactId: string;
  type: string;
  title: string;
  date: string;
  contactName: string;
  avatarUrl: string | null;
  themeColor: string | null;
  company: string | null;
  role: string | null;
  markedTitle: string | null;
  markedExcerpt: string | null;
  plainContent: string | null;
}

/** Turn marked text into plain text and the ranges the markers enclosed. */
export function readHighlights(marked: string | null | undefined): {
  text: string;
  ranges: HighlightRange[];
} {
  if (!marked) return { text: "", ranges: [] };
  const ranges: HighlightRange[] = [];
  let text = "";
  let open = -1;
  for (const char of marked) {
    if (char === OPEN) {
      open = text.length;
    } else if (char === CLOSE) {
      if (open !== -1 && text.length > open) ranges.push([open, text.length]);
      open = -1;
    } else {
      text += char;
    }
  }
  return { text, ranges };
}

/** The opening of a body, for a hit whose match was in the title. */
function opening(content: string | null): string | null {
  if (!content) return null;
  return content.length > OPENING_LENGTH
    ? `${content.slice(0, OPENING_LENGTH).trimEnd()}…`
    : content;
}

function toHit(row: RawHit): InteractionSearchHit {
  const title = readHighlights(row.markedTitle);
  const excerpt = readHighlights(row.markedExcerpt);
  const bodyMatched = excerpt.ranges.length > 0;
  return {
    id: row.id,
    contactId: row.contactId,
    type: row.type,
    title: title.text || row.title,
    date: row.date,
    excerpt: bodyMatched
      ? excerpt.text
      : opening(row.plainContent ?? excerpt.text),
    highlights: {
      title: title.ranges,
      excerpt: bodyMatched ? excerpt.ranges : [],
    },
    contact: {
      id: row.contactId,
      name: row.contactName,
      avatarUrl: row.avatarUrl,
      themeColor: row.themeColor,
      company: row.company,
      role: row.role,
    },
  };
}

interface Filters {
  sql: string;
  params: (string | number)[];
}

function filterClauses(
  range: AppliedRange | null,
  type: string | undefined,
  contactId: string | undefined,
): Filters {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (range?.from) {
    clauses.push(`AND ${INSTANT_SQL} >= ?`);
    params.push(range.from);
  }
  if (range?.to) {
    clauses.push(`AND ${INSTANT_SQL} < ?`);
    params.push(range.to);
  }
  if (type) {
    clauses.push("AND i.type = ?");
    params.push(type);
  }
  if (contactId) {
    clauses.push("AND i.contactId = ?");
    params.push(contactId);
  }
  return { sql: clauses.join(" "), params };
}

function resolveRange(
  params: InteractionSearchParams,
  phraseRange: { from: string; to: string } | null,
  timeZone: string,
): AppliedRange | null {
  if (params.from || params.to) {
    return {
      from: params.from ? boundFromFilter(params.from, "from", timeZone) : null,
      to: params.to ? boundFromFilter(params.to, "to", timeZone) : null,
      source: "filter",
    };
  }
  if (phraseRange)
    return { from: phraseRange.from, to: phraseRange.to, source: "phrase" };
  return null;
}

// =============================================================================
// The search
// =============================================================================

/**
 * Search the caller's interactions.
 *
 * With text, the page is ranked by bm25 (a title match above a body match)
 * and then by date. Without text but with a filter, it is the caller's notes
 * in that period, newest first. With neither, it is empty: listing every
 * note is what the timeline is for.
 */
export function searchInteractions(
  scope: Scope,
  params: InteractionSearchParams,
): InteractionSearchResult {
  const now = params.now ?? new Date();
  const timeZone =
    params.timeZone && isValidTimeZone(params.timeZone)
      ? params.timeZone
      : "UTC";
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.min(Math.max(params.offset ?? 0, 0), MAX_OFFSET);

  const phrase = extractDatePhrase(params.q ?? "", { now, timeZone });
  const range = resolveRange(params, phrase.range, timeZone);
  const filters = filterClauses(range, params.type, params.contactId);
  const hasFilter = filters.params.length > 0;

  // Drop the question words first. If that leaves nothing and there is no
  // filter to browse by either, search for every word rather than nothing.
  let match = compileInteractionMatch(phrase.text);
  if (!match.tokens.length && !hasFilter)
    match = compileInteractionMatch(phrase.text, true);

  const query = {
    text: match.tokens.join(" "),
    tokens: match.tokens,
    mode: "none" as MatchMode,
    phrase: phrase.range?.phrase ?? null,
    range,
    timeZone,
  };
  const empty: InteractionSearchResult = {
    query,
    total: 0,
    limit,
    offset,
    hits: [],
  };

  if (!match.strict) {
    if (!hasFilter) return empty;
    return browse(scope, filters, query, limit, offset);
  }

  // Both statements carry the owner three times: in the MATCH expression,
  // which FTS5 intersects inside the index, and on the interaction and
  // contact rows, which makes each statement true on its own.
  const from = `
    FROM interactions_fts f
    JOIN interactions i ON i.rowid = f.rowid AND i.ownerId = ?
    JOIN contacts c ON c.id = i.contactId AND c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
    WHERE interactions_fts MATCH ? ${filters.sql}`;
  const count = prepare(`SELECT COUNT(*) AS n ${from}`);
  const countFor = (expression: string): number =>
    (
      count.get(
        scope.ownerId,
        scope.ownerId,
        scopedMatch(scope, expression),
        ...filters.params,
      ) as { n: number }
    ).n;

  const wanted = params.mode ?? "auto";
  let mode: MatchMode = "all";
  let expression = match.strict;
  let total: number;
  if (wanted === "any" && match.loose) {
    mode = "any";
    expression = match.loose;
    total = countFor(expression);
  } else {
    total = countFor(expression);
    if (wanted === "auto" && total === 0 && match.loose) {
      mode = "any";
      expression = match.loose;
      total = countFor(expression);
    }
  }
  query.mode = mode;
  if (total === 0 || offset >= total) return { ...empty, total };

  const order =
    params.sort === "date"
      ? `${INSTANT_SQL} DESC, rank, i.id`
      : `rank, ${INSTANT_SQL} DESC, i.id`;
  const rows = prepare(
    `SELECT i.id, i.contactId, i.type, i.title, i.date,
              c.name AS contactName, c.avatarUrl, c.themeColor, c.company, c.role,
              highlight(interactions_fts, ${INTERACTION_FTS_TITLE_COLUMN}, char(1), char(2)) AS markedTitle,
              snippet(interactions_fts, ${INTERACTION_FTS_CONTENT_COLUMN}, char(1), char(2), '…', ${SNIPPET_TOKENS}) AS markedExcerpt,
              ${OPENING_SQL} AS plainContent,
              bm25(interactions_fts, ${INTERACTION_WEIGHTS}) AS rank
       ${from}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
  ).all(
    scope.ownerId,
    scope.ownerId,
    scopedMatch(scope, expression),
    ...filters.params,
    limit,
    offset,
  ) as RawHit[];

  return { query, total, limit, offset, hits: rows.map(toHit) };
}

/** The caller's notes in a period, or of one kind, or on one contact. */
function browse(
  scope: Scope,
  filters: Filters,
  query: InteractionSearchResult["query"],
  limit: number,
  offset: number,
): InteractionSearchResult {
  // The index row is read for its plain text only, which is why it is a
  // LEFT JOIN by rowid: a note the index has not caught up with still lists,
  // with no excerpt. The count shares the statement; an outer join to a
  // table with at most one row per rowid changes nothing about it.
  const from = `
    FROM interactions i
    JOIN contacts c ON c.id = i.contactId AND c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
    LEFT JOIN interactions_fts f ON f.rowid = i.rowid
    WHERE i.ownerId = ? ${filters.sql}`;
  const total = (
    prepare(`SELECT COUNT(*) AS n ${from}`).get(
      scope.ownerId,
      scope.ownerId,
      ...filters.params,
    ) as { n: number }
  ).n;
  if (total === 0 || offset >= total)
    return { query, total, limit, offset, hits: [] };

  const rows = prepare(
    `SELECT i.id, i.contactId, i.type, i.title, i.date,
              c.name AS contactName, c.avatarUrl, c.themeColor, c.company, c.role,
              NULL AS markedTitle, NULL AS markedExcerpt,
              ${OPENING_SQL} AS plainContent
       ${from}
       ORDER BY ${INSTANT_SQL} DESC, i.id
       LIMIT ? OFFSET ?`,
  ).all(
    scope.ownerId,
    scope.ownerId,
    ...filters.params,
    limit,
    offset,
  ) as RawHit[];
  return { query, total, limit, offset, hits: rows.map(toHit) };
}
