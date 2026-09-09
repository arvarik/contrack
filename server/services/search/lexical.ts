import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";

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

/** Retrieve active keyword matches. Apply allowed IDs before ranking and limiting. */
export function lexicalSearch(
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
  const scope = allowedIds
    ? "AND c.id IN (SELECT value FROM json_each(?))"
    : "";
  const stmt = sqlite.prepare(`
    SELECT c.id AS contactId FROM contacts_fts f
    JOIN contacts c ON c.rowid = f.rowid
    WHERE contacts_fts MATCH ? AND ${ACTIVE_CONTACT_SQL} ${scope}
    ORDER BY bm25(contacts_fts, ${WEIGHTS}), c.id LIMIT ?
  `);
  for (const strategy of strategies) {
    const params = allowedIds
      ? [strategy, JSON.stringify([...allowedIds]), limit]
      : [strategy, limit];
    const rows = stmt.all(...params) as { contactId: string }[];
    if (rows.length) return rows;
  }
  return [];
}
