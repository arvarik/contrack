// =============================================================================
// Bounded Approximate Name Matching (AI-Free Spellfix Emulation)
// =============================================================================
// Provides bounded approximate-name matching and edit-distance fallback when
// exact FTS5 keyword searches are insufficient (e.g. typos, phonetic spellings,
// Irish/Gaelic/Slavic name variants, transpositions).
//
// Background & Techniques:
// SQLite's spellfix1 extension (https://www.sqlite.org/spellfix1.html) uses:
//  1. Transliteration & character mapping (k1)
//  2. Phonetic hashing (k2)
//  3. Bounded candidate search space (pruning candidates via index)
//  4. Edit-distance re-ranking (Levenshtein / Damerau-Levenshtein)
//
// Because spellfix1 is a non-standard C extension not bundled into standard
// SQLite / better-sqlite3 distributions, this module emulates and enhances that
// approach purely using existing SQLite FTS5 prefix indexing, Double Metaphone
// phonetic hashing, and in-memory Damerau-Levenshtein / Jaro-Winkler scoring:
//  - Candidate Bounding:
//      a) contacts_fts has prefix='2 3 4' on `name`. Querying 2-character prefixes
//         prunes SQLite retrieval to a tiny candidate set (<= 25-50 rows) in < 0.3ms.
//      b) contacts has composite index `idx_contacts_owner_phonetic` on (ownerId, phoneticHash),
//         providing instant phonetic blocking for alternate spellings.
//  - Scoring:
//      In-memory multi-signal scoring via `nameSimilarity` (Damerau-Levenshtein
//      transpositions + Jaro-Winkler prefix weighting + Double Metaphone equivalence).
//  - Tenancy & Safety:
//      Strictly scoped by `ownerTok` in FTS5 and `ownerId = ?` in contacts.
// =============================================================================

import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { ownerToken, type Scope } from "../../tenancy/scope.ts";
import { tokenizeName, nameSimilarity } from "../../utils/nlp/names.ts";
import { doubleMetaphone } from "../../utils/nlp/phonetics.ts";

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
 * Find bounded approximate name matches for a query against active contacts.
 *
 * @param scope       - Tenancy scope ensuring cross-tenant isolation.
 * @param query       - Raw user query string.
 * @param limit       - Maximum number of matches to return.
 * @param allowedIds  - Optional set of contact IDs permitted by upstream filters.
 * @param excludeIds  - Optional set of contact IDs to exclude (e.g. exact matches already found).
 */
export function findApproximateNameMatches(
  scope: Scope,
  query: string,
  limit = 20,
  allowedIds?: Set<string> | null,
  excludeIds?: Set<string>,
): ApproximateNameMatch[] {
  if (limit <= 0 || allowedIds?.size === 0) return [];

  const qTokens = tokenizeName(query);
  // Name queries rarely exceed 4 tokens. Longer queries are usually sentences or note phrases.
  if (!qTokens.length || qTokens.length > 5) return [];

  // ── Step 1: Bounded candidate retrieval via FTS prefix index on name ───
  // Split tokens on punctuation/hyphens/apostrophes (e.g. "O'Callahan" → "o", "callahan")
  const subTokens = qTokens.flatMap((t) => t.split(/['\s-]+/)).filter(Boolean);
  const prefixClauses: string[] = [];
  for (const t of subTokens) {
    const clean = t.replace(/[^\p{L}\p{N}]/gu, "");
    if (clean.length >= 2) {
      prefixClauses.push(`name:"${clean.slice(0, 2)}"*`);
    }
  }

  const candidateMap = new Map<string, { id: string; name: string }>();

  if (prefixClauses.length > 0) {
    const ftsQuery = `ownerTok:${ownerToken(scope)} AND (${prefixClauses.join(" OR ")})`;
    const allowedClause = allowedIds
      ? "AND c.id IN (SELECT value FROM json_each(?))"
      : "";
    const ftsStmt = sqlite.prepare(`
      SELECT c.id, c.name FROM contacts_fts f
      JOIN contacts c ON c.rowid = f.rowid
      WHERE contacts_fts MATCH ? AND c.ownerId = ?
        AND ${ACTIVE_CONTACT_SQL} ${allowedClause}
      LIMIT 50
    `);
    const ftsParams = allowedIds
      ? [ftsQuery, scope.ownerId, JSON.stringify([...allowedIds])]
      : [ftsQuery, scope.ownerId];
    const ftsRows = ftsStmt.all(...ftsParams) as { id: string; name: string }[];
    for (const r of ftsRows) {
      if (!excludeIds?.has(r.id)) {
        candidateMap.set(r.id, r);
      }
    }
  }

  // ── Step 2: Bounded candidate retrieval via phoneticHash (Double Metaphone) ──
  const dm = doubleMetaphone(query);
  const phoneticCodes = [dm.primary, dm.alternate].filter(Boolean) as string[];
  if (phoneticCodes.length > 0) {
    const placeholders = phoneticCodes.map(() => "?").join(",");
    const allowedClause = allowedIds
      ? "AND c.id IN (SELECT value FROM json_each(?))"
      : "";
    const phoneStmt = sqlite.prepare(`
      SELECT c.id, c.name FROM contacts c
      WHERE c.ownerId = ? AND c.phoneticHash IN (${placeholders})
        AND ${ACTIVE_CONTACT_SQL} ${allowedClause}
      LIMIT 30
    `);
    const phoneParams = allowedIds
      ? [scope.ownerId, ...phoneticCodes, JSON.stringify([...allowedIds])]
      : [scope.ownerId, ...phoneticCodes];
    const phoneRows = phoneStmt.all(...phoneParams) as {
      id: string;
      name: string;
    }[];
    for (const r of phoneRows) {
      if (!excludeIds?.has(r.id)) {
        candidateMap.set(r.id, r);
      }
    }
  }

  // Also query per-token phonetics for tokens with length >= 3
  for (const t of subTokens) {
    const clean = t.replace(/[^\p{L}\p{N}]/gu, "");
    if (clean.length >= 3) {
      const tDm = doubleMetaphone(clean);
      const tCodes = [tDm.primary, tDm.alternate].filter(Boolean) as string[];
      for (const code of tCodes) {
        const allowedClause = allowedIds
          ? "AND c.id IN (SELECT value FROM json_each(?))"
          : "";
        const tokenPhoneStmt = sqlite.prepare(`
          SELECT c.id, c.name FROM contacts c
          WHERE c.ownerId = ? AND c.phoneticHash LIKE ?
            AND ${ACTIVE_CONTACT_SQL} ${allowedClause}
          LIMIT 20
        `);
        const tokenPhoneParams = allowedIds
          ? [scope.ownerId, `%${code}%`, JSON.stringify([...allowedIds])]
          : [scope.ownerId, `%${code}%`];
        const tokenRows = tokenPhoneStmt.all(...tokenPhoneParams) as {
          id: string;
          name: string;
        }[];
        for (const r of tokenRows) {
          if (!excludeIds?.has(r.id)) {
            candidateMap.set(r.id, r);
          }
        }
      }
    }
  }

  if (candidateMap.size === 0) return [];

  // ── Step 3: In-memory multi-signal scoring & filtering ─────────────────
  const scored: ApproximateNameMatch[] = [];
  for (const candidate of candidateMap.values()) {
    if (allowedIds && !allowedIds.has(candidate.id)) continue;
    if (excludeIds?.has(candidate.id)) continue;

    const score = nameSimilarity(query, candidate.name);
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

  // Sort descending by similarity score, then ascending by name
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return scored.slice(0, limit);
}
