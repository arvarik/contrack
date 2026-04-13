// =============================================================================
// Dedupe Blocking Engine — Candidate Generation + Negative Constraints
// =============================================================================
// Implements the multi-key blocking strategy (Tier 3) and negative constraint
// filter (Tier 3.5) from DEDUPE_STRATEGIES.md. This replaces the O(n²)
// brute-force comparison with an inverted-index approach that reduces
// 584,721 candidate pairs to ~2,000–5,000.
//
// Architecture:
// 1. buildBlockIndex()            — inverted index: blockKey → contactIds[]
// 2. generateCandidatePairs()     — iterate blocks → unique candidate pairs
// 3. addEmbeddingCandidates()     — KNN nearest-neighbor pairs from sqlite-vec
// 4. loadNegativeConstraints()    — co-occurrence + user exclusions
// 5. isKnownDistinct()           — fast membership test
//
// Design principles:
// - Mega-block filter: skip blocks with >100 contacts (O(k²) explosion guard)
// - De-duplication: canonical pair keys prevent duplicate candidates
// - Separation of concerns: blocking is independent of scoring
// =============================================================================

import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import type { NormalizedContact } from "./types.ts";
import { findNearestNeighbors, getEmbeddingCount } from "./embeddings.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

// =============================================================================
// Constants
// =============================================================================

/** Block size limit — blocks larger than this are skipped to avoid O(k²) pair explosion on common last names. */
const MEGA_BLOCK_THRESHOLD = 100;

/** How many KNN neighbors to query per contact for embedding-based blocking. */
const KNN_NEIGHBORS = 5;

// =============================================================================
// Canonical Pair Key
// =============================================================================

/** Create a canonical, order-independent key for a pair of IDs. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

// =============================================================================
// Block Index
// =============================================================================

/**
 * Build an inverted index from blocking keys to contact IDs.
 *
 * Each NormalizedContact already has pre-computed `blockKeys` from the
 * normalization pipeline. This function groups contacts by shared keys.
 *
 * @returns Map<blockKey, contactId[]> — the inverted index
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
 * Generate unique candidate pairs from the block index.
 *
 * For each block with 2+ contacts (and ≤ MEGA_BLOCK_THRESHOLD), generates
 * all unique pairs. Skips pairs already found by deterministic passes.
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
      log.debug("DedupeBlocking", `Skipping mega-block "${key}" with ${ids.length} contacts`);
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

// =============================================================================
// Embedding-Based Candidate Generation (Tier 3b)
// =============================================================================

/**
 * Add embedding KNN candidates to the candidate pool.
 *
 * For each contact that has an embedding, queries sqlite-vec for the
 * K nearest neighbors and adds those pairs to the candidate set.
 * This catches semantic/contextual matches that blocking keys miss
 * (e.g., career-context similarity, cross-language names).
 *
 * @param contactIds     - All contact IDs to query KNN for
 * @param alreadyPaired  - Set of pair keys already in the candidate pool
 * @returns Additional candidate pairs from embedding similarity
 */
export function addEmbeddingCandidates(
  contactIds: string[],
  alreadyPaired: Set<string>,
): { idA: string; idB: string }[] {
  const embeddingCount = getEmbeddingCount();
  if (embeddingCount === 0) {
    log.debug("DedupeBlocking", "No embeddings available — skipping KNN candidates");
    return [];
  }

  const knnStmt = sqlite.prepare(`
    SELECT ce.contactId, distance
    FROM contact_embeddings ce
    WHERE ce.embedding MATCH (
      SELECT embedding FROM contact_embeddings WHERE contactId = ?
    ) AND k = ?
    ORDER BY distance
  `);

  const seen = new Set<string>(alreadyPaired);
  const candidates: { idA: string; idB: string }[] = [];
  let queriedCount = 0;

  for (const id of contactIds) {
    try {
      const neighbors = knnStmt.all(id, KNN_NEIGHBORS + 1) as { contactId: string; distance: number }[];

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

  log.info("DedupeBlocking", `KNN: queried ${queriedCount} contacts → ${candidates.length} new candidate pairs`);
  return candidates;
}

// =============================================================================
// Negative Constraints (Tier 3.5)
// =============================================================================

/**
 * Load all negative constraints (provably-distinct pairs).
 *
 * Sources:
 * 1. Co-occurrence: contacts mentioned in the same interaction
 *    (Newtonian physics: they can't be the same person)
 * 2. User exclusions: pairs the user explicitly dismissed
 *
 * @returns Set of canonical pair keys for known-distinct pairs
 */
export function loadNegativeConstraints(): Set<string> {
  const distinctPairs = new Set<string>();

  // 1. Co-occurrence in interactions
  try {
    const coOccurrences = sqlite.prepare(`
      SELECT DISTINCT im1.contactId AS id1, im2.contactId AS id2
      FROM interaction_mentions im1
      JOIN interaction_mentions im2
        ON im1.interactionId = im2.interactionId
        AND im1.contactId < im2.contactId
    `).all() as { id1: string; id2: string }[];

    for (const row of coOccurrences) {
      distinctPairs.add(pairKey(row.id1, row.id2));
    }
    log.debug("DedupeBlocking", `Loaded ${coOccurrences.length} co-occurrence constraints`);
  } catch (err: unknown) {
    log.warn("DedupeBlocking", `Failed to load co-occurrences: ${getErrorMessage(err)}`);
  }

  // 2. User-dismissed exclusions
  try {
    const exclusions = sqlite.prepare(`
      SELECT contactIdA, contactIdB FROM dedupe_exclusions
    `).all() as { contactIdA: string; contactIdB: string }[];

    for (const row of exclusions) {
      distinctPairs.add(pairKey(row.contactIdA, row.contactIdB));
    }
    log.debug("DedupeBlocking", `Loaded ${exclusions.length} user exclusion constraints`);
  } catch (err: unknown) {
    log.warn("DedupeBlocking", `Failed to load exclusions: ${getErrorMessage(err)}`);
  }

  log.info("DedupeBlocking", `Total negative constraints: ${distinctPairs.size}`);
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
