// Dedupe blocking: candidate generation and negative constraints. An inverted
// index on blocking keys replaces comparing every pair (584,721 pairs become
// about 2,000 to 5,000).
//
// 1. buildBlockIndex()          inverted index: blockKey → contactIds[]
// 2. generateCandidatePairs()   blocks → unique candidate pairs
// 3. addEmbeddingCandidates()   KNN nearest-neighbor pairs from sqlite-vec
// 4. loadNegativeConstraints()  co-occurrence and user exclusions
// 5. isKnownDistinct()          fast membership test
//
// Blocks with more than 100 contacts are skipped (an O(k²) guard), canonical
// pair keys prevent duplicate candidates, and blocking knows nothing of
// scoring.

import { sqlite } from "../../db.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { log } from "../../utils/logger.ts";
import type { NormalizedContact } from "./types.ts";
import { getEmbeddingCount } from "./embeddings.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

// Constants

/** Block size limit — blocks larger than this are skipped to avoid O(k²) pair explosion on common last names. */
const MEGA_BLOCK_THRESHOLD = 100;

/** How many KNN neighbors to query per contact for embedding-based blocking. */
const KNN_NEIGHBORS = 5;

// Canonical pair key

/** Create a canonical, order-independent key for a pair of IDs. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

// Block index

/**
 * An inverted index from blocking keys to contact ids, from the `blockKeys`
 * normalization already computed.
 *
 * @returns Map<blockKey, contactId[]>, the inverted index
 */
export function buildBlockIndex(
  contacts: NormalizedContact[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const c of contacts) {
    for (const key of c.blockKeys) {
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(c.id);
    }
  }

  return index;
}

/**
 * Unique candidate pairs from the block index: every pair in each block of 2 to
 * MEGA_BLOCK_THRESHOLD contacts, except pairs the deterministic passes already
 * found.
 *
 * @param blockIndex   - Inverted index from buildBlockIndex()
 * @param alreadyPaired - Set of canonical pair keys already found
 * @returns Array of { idA, idB } candidate pairs + statistics
 */
export function generateCandidatePairs(
  blockIndex: Map<string, string[]>,
  alreadyPaired: Set<string>,
): { candidates: { idA: string; idB: string }[]; stats: BlockingStats } {
  const seen = new Set<string>(alreadyPaired);
  const candidates: { idA: string; idB: string }[] = [];
  let totalBlocks = 0;
  let skippedMega = 0;
  let skippedSingleton = 0;

  for (const [key, ids] of blockIndex) {
    if (ids.length < 2) {
      skippedSingleton++;
      continue;
    }
    if (ids.length > MEGA_BLOCK_THRESHOLD) {
      skippedMega++;
      log.debug(
        "DedupeBlocking",
        `Skipping a ${key.split(":", 1)[0]} mega-block with ${ids.length} contacts`,
      );
      continue;
    }

    totalBlocks++;

    // Generate all unique pairs within this block
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pk = pairKey(ids[i], ids[j]);
        if (seen.has(pk)) continue;
        seen.add(pk);
        candidates.push({ idA: ids[i], idB: ids[j] });
      }
    }
  }

  return {
    candidates,
    stats: {
      totalBlocks,
      skippedMega,
      skippedSingleton,
      totalCandidates: candidates.length,
    },
  };
}

export interface BlockingStats {
  totalBlocks: number;
  skippedMega: number;
  skippedSingleton: number;
  totalCandidates: number;
}

// Embedding candidates

/**
 * Add embedding KNN candidates: for each contact with an embedding, its K
 * nearest neighbors from sqlite-vec. This catches matches blocking keys miss,
 * such as career context or names across languages.
 *
 * @param scope          - The owner whose vectors are searched
 * @param contactIds     - All contact IDs to query KNN for
 * @param alreadyPaired  - Set of pair keys already in the candidate pool
 * @returns Additional candidate pairs from embedding similarity
 */
export function addEmbeddingCandidates(
  scope: Scope,
  contactIds: string[],
  alreadyPaired: Set<string>,
): { idA: string; idB: string }[] {
  const embeddingCount = getEmbeddingCount(scope);
  if (embeddingCount === 0) {
    log.debug(
      "DedupeBlocking",
      "No embeddings available — skipping KNN candidates",
    );
    return [];
  }

  // The owner comes from the anchor contact in the same statement. `ownerId` is
  // the vec0 partition key, so sqlite-vec reads only that owner's chunks, and a
  // neighbor from another account cannot be produced. The three status
  // predicates are metadata columns applied while the k nearest are chosen, so
  // no neighbor slot goes to an archived or trashed contact, which has no
  // normalized record and could never become a pair.
  const knnStmt = sqlite.prepare(`
    SELECT ce.contactId, distance
    FROM contact_embeddings ce
    WHERE ce.embedding MATCH (
      SELECT embedding FROM contact_embeddings WHERE contactId = ?
    )
      AND ce.ownerId = (SELECT ownerId FROM contacts WHERE id = ?)
      AND ce.isGhost = 0 AND ce.isArchived = 0 AND ce.active = 1
      AND k = ?
    ORDER BY distance
  `);

  const seen = new Set<string>(alreadyPaired);
  const candidates: { idA: string; idB: string }[] = [];
  let queriedCount = 0;

  for (const id of contactIds) {
    try {
      const neighbors = knnStmt.all(id, id, KNN_NEIGHBORS + 1) as {
        contactId: string;
        distance: number;
      }[];

      for (const n of neighbors) {
        if (n.contactId === id) continue; // skip self-match
        const pk = pairKey(id, n.contactId);
        if (seen.has(pk)) continue;
        seen.add(pk);
        candidates.push({ idA: id, idB: n.contactId });
      }
      queriedCount++;
    } catch {
      // Contact may not have an embedding — skip silently
    }
  }

  log.info(
    "DedupeBlocking",
    `KNN: queried ${queriedCount} contacts → ${candidates.length} new candidate pairs`,
  );
  return candidates;
}

// Negative constraints

/**
 * Every negative constraint, the pairs known to be two people:
 * 1. Co-occurrence: contacts mentioned in the same interaction cannot be one
 *    person.
 * 2. User exclusions: pairs a person dismissed.
 *
 * @returns Set of canonical pair keys for known-distinct pairs
 */
export function loadNegativeConstraints(scope: Scope): Set<string> {
  const distinctPairs = new Set<string>();

  // 1. Co-occurrence in interactions
  try {
    // `interaction_mentions` has no owner of its own, so the join to
    // `interactions` supplies one: two people in one note are two people only
    // within one owner's notes.
    const coOccurrences = sqlite
      .prepare(
        `
      SELECT DISTINCT im1.contactId AS id1, im2.contactId AS id2
      FROM interaction_mentions im1
      JOIN interaction_mentions im2
        ON im1.interactionId = im2.interactionId
        AND im1.contactId < im2.contactId
      JOIN interactions i ON i.id = im1.interactionId
      WHERE i.ownerId = ?
    `,
      )
      .all(scope.ownerId) as { id1: string; id2: string }[];

    for (const row of coOccurrences) {
      distinctPairs.add(pairKey(row.id1, row.id2));
    }
    log.debug(
      "DedupeBlocking",
      `Loaded ${coOccurrences.length} co-occurrence constraints`,
    );
  } catch (err: unknown) {
    log.warn(
      "DedupeBlocking",
      `Failed to load co-occurrences: ${getErrorMessage(err)}`,
    );
  }

  // 2. User-dismissed exclusions
  try {
    const exclusions = sqlite
      .prepare(
        `
      SELECT contactIdA, contactIdB FROM dedupe_exclusions WHERE ownerId = ?
    `,
      )
      .all(scope.ownerId) as { contactIdA: string; contactIdB: string }[];

    for (const row of exclusions) {
      distinctPairs.add(pairKey(row.contactIdA, row.contactIdB));
    }
    log.debug(
      "DedupeBlocking",
      `Loaded ${exclusions.length} user exclusion constraints`,
    );
  } catch (err: unknown) {
    log.warn(
      "DedupeBlocking",
      `Failed to load exclusions: ${getErrorMessage(err)}`,
    );
  }

  log.info(
    "DedupeBlocking",
    `Total negative constraints: ${distinctPairs.size}`,
  );
  return distinctPairs;
}

/**
 * Check if a pair is known to be distinct (should never be matched).
 */
export function isKnownDistinct(
  idA: string,
  idB: string,
  distinctPairs: Set<string>,
): boolean {
  return distinctPairs.has(pairKey(idA, idB));
}
