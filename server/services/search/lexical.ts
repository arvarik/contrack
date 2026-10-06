import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { ownerToken, type Scope } from "../../tenancy/scope.ts";
import {
  findApproximateNameMatches,
  STRONG_APPROXIMATE_SCORE,
} from "./approximateName.ts";
import { nicknameVariants } from "../../utils/nlp/nicknames.ts";
import { isPhoneQuery } from "../../utils/nlp/phone.ts";
import type { CompiledFacets } from "./facetSql.ts";

// bm25() reads weights by column position, one per column in COLUMNS: contactId
// (unindexed, still takes a weight), name, company, role, headline, location,
// about, industry, tags, extras, addresses, searchExpansion, ownerTok. Tags and
// interests weigh 3, as much as a role, and emails and phones 1. Addresses
// weigh 0.5, the least: a street or a postcode finds a contact, but the same
// word in any other field ranks first. ownerTok is a scoping filter and must
// not affect ranking.
export const WEIGHTS = "0, 10, 5, 3, 2, 2, 1, 1, 3, 1, 0.5, 0.5, 0";

export interface LexicalMatch {
  contactId: string;
  approximate?: boolean;
  matchType?: "exact" | "approximate";
  score?: number;
}

/** Treat user text as literal Unicode tokens, never as FTS operators. */
export function searchTokens(query: string): string[] {
  return (query.normalize("NFKC").match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).slice(
    0,
    32,
  );
}

/**
 * Wrap one retry strategy in the caller's owner token. FTS5 intersects the
 * posting list for `ownerTok:<token>` with the query's inside the index, so
 * only the owner's matches are produced; an UNINDEXED ownerId could only filter
 * afterwards, because FTS5 pushes down MATCH, rowid and rank alone.
 *
 * The strategy never reads the owner token column. The token is "o" and the
 * owner's id in hex, and the query's words are prefix clauses, so for an owner
 * whose id starts with f the word "of" would match `ofd…` in every row (one
 * account in sixteen) and move every BM25 score. `- {ownerTok} :` keeps the
 * words to the searched columns. The notes index shares this.
 */
export function scopedMatch(scope: Scope, strategy: string): string {
  return `ownerTok:${ownerToken(scope)} AND (- {ownerTok} : (${strategy}))`;
}

/**
 * One token as an FTS clause: a prefix match, or an exact match for a
 * one-letter token in the OR strategy. With `nicknames`, the token's nickname
 * group also matches, on the name column only: "bob" becomes `("bob"* OR
 * name:("robert" OR "rob" OR ...))`.
 */
function tokenClause(token: string, nicknames = false, exact = false): string {
  const clause = exact ? `"${token}"` : `"${token}"*`;
  const variants = nicknames ? nicknameVariants(token) : [];
  return variants.length
    ? `(${clause} OR name:(${variants.map((name) => `"${name}"`).join(" OR ")}))`
    : clause;
}

/**
 * A phone number as a digit clause, or null for any other query. The index
 * holds each number's digits, its last 10 and its last 7 (`PHONE_DIGITS` in
 * ftsIndex.ts), and the query's digits find all three. Its last 10 find a
 * number stored without the query's country code, and its last 7 one typed with
 * a trunk zero ("01614960321" for "+44 161 496 0321"). A contact that matches
 * more forms ranks first.
 */
function phoneClause(query: string): string | null {
  if (!isPhoneQuery(query)) return null;
  const digits = query.replace(/\D/g, "");
  const forms = new Set([
    digits,
    digits.length > 10 ? digits.slice(-10) : "",
    digits.length > 7 ? digits.slice(-7) : "",
  ]);
  return [...forms]
    .filter(Boolean)
    .map((form) => `"${form}"*`)
    .join(" OR ");
}

/**
 * Active keyword matches, with the allowed ids and facets applied before
 * ranking and limiting. A phone number is looked up by its digits first.
 *
 * Strict mode (the sidebar, and the check that decides a query's kind): the
 * contacts that match every token, then approximate names by score.
 *
 * Broad mode (hybrid retrieval's keyword channel) ranks four tiers, each in its
 * own order, so a misspelled name is not buried under people who share one word
 * of it:
 *
 * 1. every token matched, by BM25;
 * 2. approximate names scoring 0.85 or more, by score;
 * 3. partial matches, some tokens but not all, by BM25;
 * 4. approximate names from 0.75 to 0.85, by score.
 */
export function lexicalSearch(
  scope: Scope,
  query: string,
  limit = 20,
  allowedIds?: Set<string> | null,
  broad = false,
  facets?: CompiledFacets | null,
): LexicalMatch[] {
  const tokens = searchTokens(query);
  if (!tokens.length || allowedIds?.size === 0) return [];
  const allowedClause = allowedIds
    ? "AND c.id IN (SELECT value FROM json_each(?))"
    : "";
  const facetClause = facets ? `AND (${facets.sql})` : "";
  // `c.ownerId = ?` is a second guard: the owner token already restricted the
  // FTS side, and the contact row is fetched by rowid, so it costs nothing and
  // makes the statement true on its own.
  const stmt = sqlite.prepare(`
    SELECT c.id AS contactId FROM contacts_fts f
    JOIN contacts c ON c.rowid = f.rowid
    WHERE contacts_fts MATCH ? AND c.ownerId = ?
      AND ${ACTIVE_CONTACT_SQL} ${allowedClause} ${facetClause}
    ORDER BY bm25(contacts_fts, ${WEIGHTS}), c.id LIMIT ?
  `);
  const restrictions = [
    ...(allowedIds ? [JSON.stringify([...allowedIds])] : []),
    ...(facets?.params ?? []),
  ];
  const run = (strategy: string): LexicalMatch[] =>
    (
      stmt.all(
        scopedMatch(scope, strategy),
        scope.ownerId,
        ...restrictions,
        limit,
      ) as { contactId: string }[]
    ).map((row) => ({ contactId: row.contactId }));

  // A phone number that matches is the whole answer.
  const phone = phoneClause(query);
  if (phone) {
    const rows = run(phone);
    if (rows.length) return rows;
  }

  // Exact matches stay strictly first: the query as typed, then the query with
  // the nickname group of its first token, where a first name goes. So "Peggy
  // Ellington" finds Margaret Ellington, and "people I will meet" does not
  // reach for William. A rare nickname outscores a common name in BM25, so
  // nickname matches follow the literal ones: every Margaret before a Maggie.
  let exactRows = run(tokens.map((token) => tokenClause(token)).join(" AND "));
  if (exactRows.length < limit && nicknameVariants(tokens[0]).length) {
    const literal = new Set(exactRows.map((r) => r.contactId));
    const nicknames = run(
      tokens.map((token, i) => tokenClause(token, i === 0)).join(" AND "),
    ).filter((r) => !literal.has(r.contactId));
    exactRows = [...exactRows, ...nicknames].slice(0, limit);
  }
  if (exactRows.length >= limit) return exactRows;

  const seen = new Set(exactRows.map((r) => r.contactId));
  // In strict mode the approximate names fill the rest of the limit. In
  // broad mode all of them are needed: the strong ones go before the
  // partial matches and the weak ones after.
  const approxMatches = findApproximateNameMatches(
    scope,
    query,
    broad ? limit : limit - exactRows.length,
    allowedIds,
    seen,
    facets,
  );
  if (!broad || tokens.length < 2)
    return [...exactRows, ...approxMatches].slice(0, limit);

  const strong = approxMatches.filter(
    (m) => (m.score ?? 0) >= STRONG_APPROXIMATE_SCORE,
  );
  const weak = approxMatches.filter(
    (m) => (m.score ?? 0) < STRONG_APPROXIMATE_SCORE,
  );
  // A one-letter token, such as the O of O'Callahan, would make every
  // O'Brien a partial match. It counts only when the query has nothing
  // longer.
  const longer = tokens.filter((token) => token.length > 1);
  const partial = run(
    (longer.length ? longer : tokens)
      .map((token) => tokenClause(token, false, token.length < 2))
      .join(" OR "),
  );

  const ranked: LexicalMatch[] = [];
  const ranks = new Set<string>();
  for (const match of [...exactRows, ...strong, ...partial, ...weak]) {
    if (ranked.length >= limit) break;
    if (ranks.has(match.contactId)) continue;
    ranks.add(match.contactId);
    ranked.push(match);
  }
  return ranked;
}
