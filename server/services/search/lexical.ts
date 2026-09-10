import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { ownerToken, type Scope } from "../../tenancy/scope.ts";

// The first FTS column is the unindexed contactId. It still consumes a weight.
// bm25() reads weights by column position, so one weight per column in COLUMNS.
// The last is ownerTok, which is a scoping filter and must not affect ranking.
export const WEIGHTS = "0, 10, 5, 3, 2, 2, 1, 1, 1, 0.5, 0";

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

/** Retrieve active keyword matches. Apply allowed IDs before ranking and limiting. */
export function lexicalSearch(
  scope: Scope,
  query: string,
  limit = 20,
  allowedIds?: Set<string> | null,
  broad = false,
): { contactId: string }[] {
  const tokens = searchTokens(query);
  if (!tokens.length || allowedIds?.size === 0) return [];
  const clauses = tokens.map((token) => `"${token}"*`);
  const strategies = [clauses.join(" AND ")];
  if (broad && tokens.length > 1) strategies.push(clauses.join(" OR "));
  const allowedClause = allowedIds
    ? "AND c.id IN (SELECT value FROM json_each(?))"
    : "";
  // `c.ownerId = ?` is a second guard, not the filter that does the work. The
  // owner token has already restricted the FTS side, and the contact row is
  // fetched by rowid, so this costs nothing and makes the statement true on
  // its own.
  const stmt = sqlite.prepare(`
    SELECT c.id AS contactId FROM contacts_fts f
    JOIN contacts c ON c.rowid = f.rowid
    WHERE contacts_fts MATCH ? AND c.ownerId = ?
      AND ${ACTIVE_CONTACT_SQL} ${allowedClause}
    ORDER BY bm25(contacts_fts, ${WEIGHTS}), c.id LIMIT ?
  `);
  for (const strategy of strategies) {
    const params = allowedIds
      ? [
          scopedMatch(scope, strategy),
          scope.ownerId,
          JSON.stringify([...allowedIds]),
          limit,
        ]
      : [scopedMatch(scope, strategy), scope.ownerId, limit];
    const rows = stmt.all(...params) as { contactId: string }[];
    if (rows.length) return rows;
  }
  return [];
}
