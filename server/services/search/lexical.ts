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

// The first FTS column is the unindexed contactId. It still consumes a weight.
// bm25() reads weights by column position, so one weight per column in COLUMNS:
// contactId, name, company, role, headline, location, about, industry, tags,
// extras, searchExpansion, ownerTok. Tags and interests weigh 3, as much as a
// role, and emails and phones keep 1. The last is ownerTok, which is a
// scoping filter and must not affect ranking.
export const WEIGHTS = "0, 10, 5, 3, 2, 2, 1, 1, 3, 1, 0.5, 0";

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
 * Wrap one retry strategy in the caller's owner token.
 *
 * FTS5 intersects the posting list for `ownerTok:<token>` with the posting
 * lists of the query tokens inside the index, so only the owner's matches are
 * ever produced. An UNINDEXED ownerId column could not do this: FTS5 pushes
 * down MATCH, rowid and rank alone, and everything else is a post-filter over
 * rows the caller may not read. The architecture document, section 6.2, has
 * the measurements.
 */
export function scopedMatch(scope: Scope, strategy: string): string {
  return `ownerTok:${ownerToken(scope)} AND (${strategy})`;
}

/**
 * One token as an FTS clause: a prefix match, or an exact match for a
 * one-letter token in the OR strategy.
 *
 * The query's first token is where a first name goes. When it has
 * nicknames, the other names of its group also match, on the name column
 * only: "bob" becomes `("bob"* OR name:("robert" OR "rob" OR ...))`. Only
 * the first token, so a sentence such as "people I will meet" does not
 * reach for William.
 */
function tokenClause(token: string, index: number, exact = false): string {
  const clause = exact ? `"${token}"` : `"${token}"*`;
  const variants = index === 0 ? nicknameVariants(token) : [];
  return variants.length
    ? `(${clause} OR name:(${variants.map((name) => `"${name}"`).join(" OR ")}))`
    : clause;
}

/**
 * A phone number as a digit clause, or null for any other query.
 *
 * The index holds each stored number's digits, its last 10 and its last 7
 * (`PHONES` in ftsIndex.ts). The query's digits find all three. Its last 10 find
 * a number stored without the country code the query has, and its last 7
 * find one typed with a trunk zero ("01614960321" for "+44 161 496 0321").
 * A contact that matches more of the forms ranks first.
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
 * Retrieve active keyword matches. Apply allowed IDs and facets before
 * ranking and limiting.
 *
 * Strict mode (the sidebar, and the check that decides a query's kind):
 * the contacts that match every token, then approximate names by score.
 *
 * Broad mode (the keyword channel of hybrid retrieval) ranks four tiers,
 * each in its own order:
 *
 * 1. every token matched, by BM25;
 * 2. approximate names scoring 0.85 or more, by score;
 * 3. partial matches, some tokens but not all, by BM25;
 * 4. approximate names from 0.75 to 0.85, by score.
 *
 * Before, every partial match outranked every approximate name, so at 5,000
 * contacts a misspelled name fell behind people who shared one word of it.
 *
 * A phone number is looked up by its digits first, in both modes.
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
  // `c.ownerId = ?` is a second guard, not the filter that does the work. The
  // owner token has already restricted the FTS side, and the contact row is
  // fetched by rowid, so this costs nothing and makes the statement true on
  // its own.
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

  // Exact matches always stay strictly first.
  const exactRows = run(
    tokens.map((token, i) => tokenClause(token, i)).join(" AND "),
  );
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
  const partialTokens = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.length > 1);
  const partial = run(
    (partialTokens.length
      ? partialTokens
      : tokens.map((token, index) => ({ token, index }))
    )
      .map(({ token, index }) => tokenClause(token, index, token.length < 2))
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
