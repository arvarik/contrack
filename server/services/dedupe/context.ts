import { sqlite } from "../../db.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { log } from "../../utils/logger.ts";
import { loadProfileUrls, normalizeContacts } from "./normalization.ts";
import { loadNegativeConstraints, pairKey } from "./blocking.ts";
import { countValues } from "./policy.ts";
import { distanceToSimilarity } from "./scoring.ts";
import type { ContactRow, NormalizedContact, PassContext } from "./types.ts";

/**
 * Build the context every detection pass shares, with the expensive loading
 * done up front in batch queries.
 */
export function buildPassContext(scope: Scope, rid: string): PassContext {
  const t0 = Date.now();

  // 1. The owner's contacts, scoped like normalizeContacts below, so the
  //    contact list and the normalized map cover the same rows.
  const allContacts = sqlite
    .prepare(
      `SELECT * FROM contacts
        WHERE ownerId = ? AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
          AND canonicalId IS NULL`,
    )
    .all(scope.ownerId) as ContactRow[];

  const contactMap = new Map<string, ContactRow>();
  for (const c of allContacts) contactMap.set(c.id, c);

  // 2. Normalize all contacts (batch)
  const normalized = normalizeContacts(scope);
  const normalizedMap = new Map<string, NormalizedContact>();
  for (const n of normalized) normalizedMap.set(n.id, n);

  // 3. Load negative constraints
  const distinctPairs = loadNegativeConstraints(scope);

  // 4. The owner's personal profile links, normalized
  const socialUrlsByContact = loadProfileUrls(scope);

  log.info(
    "DedupeService",
    `[${rid}] Context built in ${Date.now() - t0}ms: ${allContacts.length} contacts, ${normalized.length} normalized, ${distinctPairs.size} negative constraints`,
  );

  return {
    scope,
    allContacts,
    contactMap,
    normalized,
    normalizedMap,
    seenPairs: new Set(),
    distinctPairs,
    socialUrlsByContact,
    // 5. Count carriers per value, once. The passes read this rather than
    //    counting for themselves, so a scan and an import weigh a shared
    //    number the same way.
    frequency: countValues(normalized),
    embeddingSimCache: new Map(),
    rid,
  };
}

/**
 * The cosine similarity of two contacts' embeddings, cached so a pair costs one
 * sqlite-vec query.
 */
export function getEmbeddingSimilarity(
  idA: string,
  idB: string,
  ctx: PassContext,
): number {
  const pk = pairKey(idA, idB);
  if (ctx.embeddingSimCache.has(pk)) return ctx.embeddingSimCache.get(pk)!;

  let similarity = 0;
  try {
    const row = sqlite
      .prepare(
        // As in blocking.ts's KNN, the owner is read from the anchor contact
        // inside the statement, so sqlite-vec searches the anchor's own
        // partition, and a pair that spans two accounts scores zero.
        `
      SELECT distance FROM contact_embeddings
      WHERE embedding MATCH (
        SELECT embedding FROM contact_embeddings WHERE contactId = ?
      )
        AND ownerId = (SELECT ownerId FROM contacts WHERE id = ?)
        AND k = 20 AND contactId = ?
    `,
      )
      .get(idA, idA, idB) as { distance: number } | undefined;

    if (row) {
      similarity = distanceToSimilarity(row.distance);
    }
  } catch {
    // One or both contacts may not have embeddings — return 0
  }

  ctx.embeddingSimCache.set(pk, similarity);
  return similarity;
}
