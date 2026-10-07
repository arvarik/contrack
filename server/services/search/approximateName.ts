// Bounded approximate-name matching with no model, for when exact FTS5 keyword
// search misses: typos, phonetic spellings, Irish, Gaelic or Slavic variants,
// transpositions. It follows SQLite's spellfix1 (character mapping, phonetic
// hashing, a bounded candidate set, edit-distance re-ranking), which ships in
// neither SQLite nor better-sqlite3, with what is here:
//
// - Candidates come from two sources, each with a fixed order and a limit of
//   200, so no arbitrary cut drops a better match.
// - contacts_fts has prefix='2 3 4' on `name`. One query asks for each token's
//   3-letter prefix (tokens of 4 letters or more), its 2-letter prefix, and the
//   other names of its nickname group. BM25 orders the rows, so a name that
//   shares more of the query ranks first. The 2-letter prefix is there because
//   a typo in the third letter is common: "Kristof" and "Krzysztof" share "kr".
// - `idx_contacts_owner_phonetic` on (ownerId, phoneticHash) blocks alternate
//   spellings. The stored hash is the whole name's code, so it is compared for
//   equality with the code of the whole query and of each token.
// - Scoring: `nameSimilarity` in memory (Damerau-Levenshtein transpositions,
//   Jaro-Winkler prefix weight, Double Metaphone equivalence).
// - Tenancy: scoped by `ownerTok` in FTS5 and `ownerId = ?` in contacts.

import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { ownerToken, type Scope } from "../../tenancy/scope.ts";
import { tokenizeName, nameScorer } from "../../utils/nlp/names.ts";
import { doubleMetaphone } from "../../utils/nlp/phonetics.ts";
import { nicknameVariants } from "../../utils/nlp/nicknames.ts";
import type { CompiledFacets } from "./facetSql.ts";

export interface ApproximateNameMatch {
  contactId: string;
  name: string;
  score: number;
  approximate: true;
  matchType: "approximate";
}

/** Minimum similarity score for an approximate match to qualify (0.75 filters spurious candidates). */
export const APPROXIMATE_NAME_THRESHOLD = 0.75;

/**
 * An approximate name this close is strong evidence. Broad keyword search
 * ranks it above partial matches, and `classifyQuery` reads it as a name.
 */
export const STRONG_APPROXIMATE_SCORE = 0.85;

/** Rows each candidate source may return, in its fixed order. */
const CANDIDATE_LIMIT = 200;

interface Candidate {
  id: string;
  name: string;
}

/**
 * Bounded approximate name matches for a query among active contacts.
 *
 * @param scope       - The caller's scope.
 * @param query       - Raw user query string.
 * @param limit       - Maximum number of matches to return.
 * @param allowedIds  - Optional set of contact IDs permitted by upstream
 *   filters.
 * @param excludeIds  - Optional set of contact IDs to exclude (e.g. exact
 *   matches already found).
 * @param facets      - Optional facet predicate, applied before each source's
 *   limit.
 * @returns every match scoring 0.75 or more, best first, at most `limit`.
 */
export function findApproximateNameMatches(
  scope: Scope,
  query: string,
  limit = 20,
  allowedIds?: Set<string> | null,
  excludeIds?: Set<string>,
  facets?: CompiledFacets | null,
): ApproximateNameMatch[] {
  if (limit <= 0 || allowedIds?.size === 0) return [];

  const qTokens = tokenizeName(query);
  // Name queries rarely exceed 4 tokens. Longer queries are usually sentences or note phrases.
  if (!qTokens.length || qTokens.length > 5) return [];

  // Split tokens on punctuation/hyphens/apostrophes (e.g. "O'Callahan" → "o", "callahan")
  const subTokens = qTokens
    .flatMap((t) => t.split(/['\s-]+/))
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  // The upstream filters, as SQL and the values they bind.
  const allowedClause = allowedIds
    ? "AND c.id IN (SELECT value FROM json_each(?))"
    : "";
  const facetClause = facets ? `AND (${facets.sql})` : "";
  const restrictions = [
    ...(allowedIds ? [JSON.stringify([...allowedIds])] : []),
    ...(facets?.params ?? []),
  ];

  const candidates = new Map<string, Candidate>();
  const add = (rows: Candidate[]) => {
    for (const row of rows)
      if (!excludeIds?.has(row.id) && !candidates.has(row.id))
        candidates.set(row.id, row);
  };

  // Step 1: name prefixes and nickname variants, by BM25
  const clauses = new Set<string>();
  for (const token of subTokens) {
    if (token.length >= 4) clauses.add(`name:"${token.slice(0, 3)}"*`);
    if (token.length >= 2) clauses.add(`name:"${token.slice(0, 2)}"*`);
  }
  for (const token of qTokens)
    for (const variant of nicknameVariants(token))
      clauses.add(`name:"${variant}"`);

  if (clauses.size > 0) {
    const ftsQuery = `ownerTok:${ownerToken(scope)} AND (${[...clauses].join(" OR ")})`;
    // Every phrase is on the name column, and the owner token is the same on
    // every row, so plain bm25() orders the rows by the name alone.
    add(
      sqlite
        .prepare(
          `
      SELECT c.id, c.name FROM contacts_fts f
      JOIN contacts c ON c.rowid = f.rowid
      WHERE contacts_fts MATCH ? AND c.ownerId = ?
        AND ${ACTIVE_CONTACT_SQL} ${allowedClause} ${facetClause}
      ORDER BY bm25(contacts_fts), c.id
      LIMIT ${CANDIDATE_LIMIT}
    `,
        )
        .all(ftsQuery, scope.ownerId, ...restrictions) as Candidate[],
    );
  }

  // Step 2: phonetic codes, by the (ownerId, phoneticHash) index
  const codes = new Set<string>();
  const addCodes = (text: string) => {
    const dm = doubleMetaphone(text);
    if (dm.primary) codes.add(dm.primary);
    if (dm.alternate) codes.add(dm.alternate);
  };
  addCodes(query);
  for (const token of subTokens) if (token.length >= 3) addCodes(token);

  if (codes.size > 0) {
    const placeholders = [...codes].map(() => "?").join(",");
    add(
      sqlite
        .prepare(
          `
      SELECT c.id, c.name FROM contacts c
      WHERE c.ownerId = ? AND c.phoneticHash IN (${placeholders})
        AND ${ACTIVE_CONTACT_SQL} ${allowedClause} ${facetClause}
      ORDER BY c.id
      LIMIT ${CANDIDATE_LIMIT}
    `,
        )
        .all(scope.ownerId, ...codes, ...restrictions) as Candidate[],
    );
  }

  if (candidates.size === 0) return [];

  // Step 3: In-memory multi-signal scoring & filtering
  const similarity = nameScorer(query);
  const scored: ApproximateNameMatch[] = [];
  for (const candidate of candidates.values()) {
    const score = similarity(candidate.name);
    if (score >= APPROXIMATE_NAME_THRESHOLD) {
      scored.push({
        contactId: candidate.id,
        name: candidate.name,
        score,
        approximate: true,
        matchType: "approximate",
      });
    }
  }

  // Sort descending by similarity score, then ascending by name and id
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.name.localeCompare(b.name) ||
      (a.contactId < b.contactId ? -1 : 1),
  );

  return scored.slice(0, limit);
}
