import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { normalizeContacts } from "./normalization.ts";
import { loadNegativeConstraints, pairKey } from "./blocking.ts";
import { distanceToSimilarity } from "./scoring.ts";
import type { NormalizedContact, PassContext } from "./types.ts";

/**
 * Build the shared context used by all detection passes.
 * Performs all expensive loading upfront in batch queries.
 */
export function buildPassContext(rid: string): PassContext {
  const t0 = Date.now();

  // 1. Load all contacts
  const allContacts = sqlite
    .prepare(
      "SELECT * FROM contacts WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL",
    )
    .all() as any[];

  const contactMap = new Map<string, any>();
  for (const c of allContacts) contactMap.set(c.id, c);

  // 2. Normalize all contacts (batch)
  const normalized = normalizeContacts();
  const normalizedMap = new Map<string, NormalizedContact>();
  for (const n of normalized) normalizedMap.set(n.id, n);

  // 3. Load negative constraints
  const distinctPairs = loadNegativeConstraints();

  // 4. Batch-load social URLs
  const allSocialLinks = sqlite
    .prepare(
      "SELECT contactId, LOWER(TRIM(url)) AS url FROM contact_social_links",
    )
    .all() as { contactId: string; url: string }[];

  const socialUrlsByContact = new Map<string, string[]>();
  for (const sl of allSocialLinks) {
    if (!socialUrlsByContact.has(sl.contactId))
      socialUrlsByContact.set(sl.contactId, []);
    socialUrlsByContact.get(sl.contactId)!.push(sl.url);
  }

  log.info(
    "DedupeService",
    `[${rid}] Context built in ${Date.now() - t0}ms: ${allContacts.length} contacts, ${normalized.length} normalized, ${distinctPairs.size} negative constraints`,
  );

  return {
    allContacts,
    contactMap,
    normalized,
    normalizedMap,
    seenPairs: new Set(),
    distinctPairs,
    socialUrlsByContact,
    embeddingSimCache: new Map(),
    rid,
  };
}

/**
 * Get the embedding cosine similarity between two contacts.
 * Uses a cache to avoid redundant sqlite-vec queries.
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
        `
      SELECT distance FROM contact_embeddings
      WHERE embedding MATCH (
        SELECT embedding FROM contact_embeddings WHERE contactId = ?
      ) AND k = 20 AND contactId = ?
    `,
      )
      .get(idA, idB) as { distance: number } | undefined;

    if (row) {
      similarity = distanceToSimilarity(row.distance);
    }
  } catch {
    // One or both contacts may not have embeddings — return 0
  }

  ctx.embeddingSimCache.set(pk, similarity);
  return similarity;
}
