import { runWithContext } from "../../tenancy/requestContext.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { dedupeQueue } from "./jobQueue.ts";
import { buildPassContext } from "./context.ts";
import {
  backfillOwnerEmbeddings,
  isEmbeddingAvailable,
  getEmbeddingCount,
  clearOwnerEmbeddings,
  reEmbedStaleContacts,
} from "./embeddings.ts";
import {
  buildIncrementalCorpus,
  findIncrementalPairs,
  normalizeTarget,
  type IncrementalCorpus,
} from "./incremental.ts";
import { scopeOfContact } from "./normalization.ts";
import { runDeterministicPass, runFunnelPass } from "./passes.ts";
import { buildClusters, computePrimaryScore } from "./clustering.ts";
import {
  storeSuggestion,
  storeSuggestions,
  clearStaleSuggestions,
  clearAllPendingSuggestions,
  liveContactId,
} from "./suggestions.ts";
import { softMergeContacts, mergeContacts } from "./merging.ts";
import { pairKey } from "./blocking.ts";
import { autoMergeThresholdFor, reasonWithCaveat } from "./policy.ts";
import type { DedupeScanMode, RawPair, MatchType } from "./types.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

/**
 * Save the pairs one contact produced. A pair at or above the auto-merge
 * threshold merges now and is recorded `auto_merged`; the rest become pending
 * suggestions, and so does a pair whose merge throws.
 *
 * Every pair is stored against the contacts live now: merges run first, and
 * each id is followed to the contact it lives on, so "X shares a phone with C"
 * becomes "B shares a phone with C" once X merged into B. Stored as found, the
 * pair would wait in the review list for a hidden contact. A pair whose two
 * sides are now one contact is done, and a pair the account kept apart stays
 * apart.
 *
 * Returns what went where, so a batch can add up its summary, and adds every
 * merged-away contact to `corpus.retired`, so later contacts in the batch are
 * not offered it.
 */
function persistIncrementalPairs(
  corpus: IncrementalCorpus,
  pairs: RawPair[],
  rid: string,
  autoMergeThreshold: number,
): { autoMerged: number; pending: number } {
  const { scope } = corpus;
  let autoMerged = 0;
  let pending = 0;

  const live = (found: RawPair): RawPair | null => {
    const idA = liveContactId(scope, found.idA);
    const idB = liveContactId(scope, found.idB);
    if (!idA || !idB || idA === idB) return null;
    if (corpus.distinctPairs.has(pairKey(idA, idB))) return null;
    return { ...found, idA, idB };
  };

  for (const found of pairs) {
    if (found.confidence < autoMergeThreshold) continue;
    const pair = live(found);
    if (!pair) continue;
    try {
      const hydrated = new Map(
        contactRepo
          .hydrateMany(contactRepo.findManyOwned(scope, [pair.idA, pair.idB]))
          .map((c) => [c.id, c]),
      );
      const rawA = hydrated.get(pair.idA);
      const rawB = hydrated.get(pair.idB);
      if (!rawA || !rawB) continue;

      const scoreA = computePrimaryScore(scope, rawA);
      const scoreB = computePrimaryScore(scope, rawB);
      const [primaryId, duplicateId] =
        scoreA >= scoreB ? [pair.idA, pair.idB] : [pair.idB, pair.idA];

      dedupeService.softMergeContacts(
        scope,
        primaryId,
        duplicateId,
        pair.confidence,
        reasonWithCaveat(pair.reasoning, pair.caveat),
        rid,
      );
      storeSuggestion(scope, pair, "auto_merged");
      corpus.retired.add(duplicateId);
      autoMerged++;
    } catch (err: unknown) {
      log.warn(
        "DedupeService",
        `[${rid}] Incremental auto-merge failed: ${getErrorMessage(err)}`,
      );
      storeSuggestion(scope, pair, "pending");
      pending++;
    }
  }

  for (const found of pairs) {
    if (found.confidence >= autoMergeThreshold) continue;
    const pair = live(found);
    if (!pair) continue;
    storeSuggestion(scope, pair, "pending");
    pending++;
  }

  return { autoMerged, pending };
}

/**
 * One incremental check, inside the contact owner's context. Every read names
 * that owner: a duplicate can only be another contact in the same account, and
 * a candidate from anywhere else would be a leak.
 */
async function runIncrementalCheck(
  scope: Scope,
  contactId: string,
  rid: string,
  autoMergeThreshold: number,
): Promise<void> {
  const t0 = Date.now();
  try {
    const corpus = buildIncrementalCorpus(scope, rid);
    const target = normalizeTarget(corpus, contactId);
    if (!target) {
      log.debug(
        "DedupeService",
        `[${rid}] Incremental: contact ${contactId} has no usable name — skipping`,
      );
      return;
    }

    const pairs = findIncrementalPairs(corpus, contactId, target, new Set());
    if (pairs.length === 0) {
      log.debug(
        "DedupeService",
        `[${rid}] Incremental: no duplicates found for ${contactId} (${Date.now() - t0}ms)`,
      );
      return;
    }

    persistIncrementalPairs(corpus, pairs, rid, autoMergeThreshold);
    log.info(
      "DedupeService",
      `[${rid}] Incremental: ${pairs.length} match(es) for ${contactId} in ${Date.now() - t0}ms`,
    );
  } catch (err: unknown) {
    log.error(
      "DedupeService",
      `[${rid}] Incremental check failed for ${contactId}: ${getErrorMessage(err)}`,
    );
  }
}

export const dedupeService = {
  mergeContacts,
  softMergeContacts,

  /**
   * Find this account's duplicates and save them. The scope is an argument, not
   * a context read: a queued scan starts long after its request, inside another
   * account's completion callback, where an ambient owner would be wrong.
   */
  async runScan(
    scope: Scope,
    scanId: string,
    mode: DedupeScanMode,
    rid: string,
    requestedThreshold?: number,
  ): Promise<void> {
    dedupeQueue.setProcessing(true);
    // The account's preset unless the caller named a number. The same
    // resolution the import and the single-contact check make, so a preset
    // chosen in Settings governs every path that merges.
    const autoMergeThreshold =
      requestedThreshold ?? autoMergeThresholdFor(scope);
    let embeddingsReady = false;

    try {
      dedupeQueue.update(scanId, {
        phase: "normalizing",
        phaseName: "Reading contacts",
      });

      const ctx = buildPassContext(scope, rid);

      dedupeQueue.update(scanId, {
        totalContacts: ctx.allContacts.length,
        contactsScanned: 0,
      });

      if (ctx.allContacts.length < 2) {
        dedupeQueue.complete(scanId, []);
        return;
      }

      if (mode !== "quick" && isEmbeddingAvailable()) {
        const existingCount = getEmbeddingCount(scope);
        const needsBackfill = mode === "full" || existingCount === 0;

        if (needsBackfill) {
          dedupeQueue.update(scanId, {
            phase: "normalizing",
            phaseName: "Preparing contacts for comparison",
          });

          try {
            if (mode === "full") {
              clearOwnerEmbeddings(scope);
              log.info(
                "DedupeService",
                `[${rid}] Full mode: cleared this account's embeddings for re-generation`,
              );
            }

            const embedded = await backfillOwnerEmbeddings(
              scope,
              (done, total) => {
                dedupeQueue.update(scanId, {
                  phaseName: `Preparing contacts for comparison (${done} of ${total})`,
                });
              },
            );
            log.info(
              "DedupeService",
              `[${rid}] Embedding backfill: ${embedded} contacts embedded`,
            );
            // A backfill already running elsewhere makes this one a no-op that
            // returns 0. In full mode the vectors were just cleared, so
            // trusting the count would send the scan into a KNN over an empty
            // partition and report "no duplicates" for an account that has
            // them. Ask the store.
            embeddingsReady = embedded > 0 || getEmbeddingCount(scope) > 0;
            if (!embeddingsReady) {
              log.warn(
                "DedupeService",
                `[${rid}] No embeddings for this account after the backfill — continuing with deterministic + name-based passes only`,
              );
            }
          } catch (err: unknown) {
            log.warn(
              "DedupeService",
              `[${rid}] Embedding backfill failed: ${getErrorMessage(err)} — continuing with deterministic + name-based passes only`,
            );
            embeddingsReady = false;
          }
        } else {
          // Embeddings already exist (deep scan, not full), re-embed stale contacts
          try {
            const reEmbedded = await reEmbedStaleContacts(scope);
            if (reEmbedded > 0) {
              log.info(
                "DedupeService",
                `[${rid}] Re-embedded ${reEmbedded} stale contact(s)`,
              );
            }
            embeddingsReady = true;
          } catch (err: unknown) {
            log.warn(
              "DedupeService",
              `[${rid}] Stale re-embedding failed: ${getErrorMessage(err)}`,
            );
            embeddingsReady = getEmbeddingCount(scope) > 0;
          }
        }
      } else if (mode !== "quick") {
        log.warn(
          "DedupeService",
          `[${rid}] Gemini API unavailable — skipping embedding-based blocking`,
        );
      }

      const allPairs: RawPair[] = [];

      dedupeQueue.update(scanId, {
        phase: "deterministic",
        phaseName: "Looking for the same email, phone or name",
        contactsScanned: 0,
      });

      const deterministicResults = runDeterministicPass(ctx);
      allPairs.push(...deterministicResults);

      dedupeQueue.update(scanId, {
        deterministicFound: deterministicResults.length,
        contactsScanned: ctx.allContacts.length,
      });

      if (mode !== "quick") {
        const funnelResults = await runFunnelPass(ctx, scanId, embeddingsReady);
        allPairs.push(...funnelResults);

        dedupeQueue.update(scanId, {
          aiCandidatesFound: funnelResults.length,
          contactsScanned: ctx.allContacts.length,
        });
      }

      dedupeQueue.update(scanId, {
        phase: "clustering",
        phaseName: "Grouping",
        totalPairs: allPairs.length,
      });

      const clusters = buildClusters(scope, allPairs, ctx.contactMap, rid);

      dedupeQueue.update(scanId, {
        phase: "persisting",
        phaseName: "Saving",
      });

      clearStaleSuggestions(scope);
      clearAllPendingSuggestions(scope);

      const autoMergePairs: RawPair[] = [];
      const pendingPairs: RawPair[] = [];

      for (const cluster of clusters) {
        const isSmallCluster = cluster.size === 2;
        const allHighConfidence = cluster.pairs.every(
          (p) => p.confidence >= autoMergeThreshold,
        );

        if (
          isSmallCluster &&
          allHighConfidence &&
          !cluster.requiresConfirmation
        ) {
          for (const pair of cluster.pairs) {
            autoMergePairs.push({
              idA: pair.contactIdA,
              idB: pair.contactIdB,
              matchType: pair.matchType as MatchType,
              confidence: pair.confidence,
              reasoning: pair.reasoning,
              matchedField: pair.matchedField,
              caveat: pair.caveat,
            });
          }
        } else {
          for (const pair of cluster.pairs) {
            pendingPairs.push({
              idA: pair.contactIdA,
              idB: pair.contactIdB,
              matchType: pair.matchType as MatchType,
              confidence: pair.confidence,
              reasoning: pair.reasoning,
              matchedField: pair.matchedField,
              caveat: pair.caveat,
            });
          }
        }
      }

      const merged: RawPair[] = [];
      const autoMergeIds = [
        ...new Set(autoMergePairs.flatMap((p) => [p.idA, p.idB])),
      ];
      // Every id came from `ctx.contactMap`, which `buildPassContext` filled
      // from one scoped query, so hydration never reaches outside the account.
      const autoMergeRawRows = autoMergeIds
        .map((id) => ctx.contactMap.get(id))
        .filter(Boolean);
      const autoMergeHydratedMap = new Map(
        contactRepo.hydrateMany(autoMergeRawRows).map((c) => [c.id, c]),
      );

      for (const pair of autoMergePairs) {
        try {
          const hydratedA = autoMergeHydratedMap.get(pair.idA);
          const hydratedB = autoMergeHydratedMap.get(pair.idB);
          if (!hydratedA || !hydratedB) continue;

          const scoreA = computePrimaryScore(scope, hydratedA);
          const scoreB = computePrimaryScore(scope, hydratedB);
          const [primaryId, duplicateId] =
            scoreA >= scoreB ? [pair.idA, pair.idB] : [pair.idB, pair.idA];

          dedupeService.softMergeContacts(
            scope,
            primaryId,
            duplicateId,
            pair.confidence,
            reasonWithCaveat(pair.reasoning, pair.caveat),
            rid,
          );
          merged.push(pair);
        } catch (err: unknown) {
          log.warn(
            "DedupeService",
            `[${rid}] Auto-merge failed for ${pair.idA} ↔ ${pair.idB}: ${getErrorMessage(err)}`,
          );
          pendingPairs.push(pair);
        }
      }

      if (merged.length > 0) storeSuggestions(scope, merged, "auto_merged");
      if (pendingPairs.length > 0) {
        storeSuggestions(scope, pendingPairs, "pending");
      }

      log.info(
        "DedupeService",
        `[${rid}] Persisted: ${merged.length} auto-merged, ${pendingPairs.length} pending suggestions`,
      );

      dedupeQueue.update(scanId, {
        autoMerged: merged.length,
        pendingSuggestions: pendingPairs.length,
      });

      // The results hold only what is left to review: a group merged above is
      // done, and offering it again would put a hidden contact forward as a
      // primary.
      const mergedIds = new Set(merged.flatMap((p) => [p.idA, p.idB]));
      dedupeQueue.complete(
        scanId,
        clusters.filter(
          (c) =>
            !c.pairs.every(
              (p) => mergedIds.has(p.contactIdA) && mergedIds.has(p.contactIdB),
            ),
        ),
      );
    } catch (err: unknown) {
      log.error(
        "DedupeService",
        `[${rid}] Scan ${scanId} failed: ${getErrorMessage(err)}`,
      );
      dedupeQueue.fail(scanId, getErrorMessage(err) || "Unknown error");
    }
  },

  /**
   * Check one just-written contact against its own account. A debounced timer
   * calls this after the request returned, so the owner comes from the contact
   * row, and the check runs inside `runWithContext`, so its AI rows name the
   * right account.
   */
  async incrementalDedupeCheck(
    contactId: string,
    rid: string,
    requestedThreshold?: number,
  ): Promise<void> {
    const scope = scopeOfContact(contactId);
    if (!scope) {
      log.debug(
        "DedupeService",
        `[${rid}] Incremental: contact ${contactId} not found — skipping`,
      );
      return;
    }
    const autoMergeThreshold =
      requestedThreshold ?? autoMergeThresholdFor(scope);
    return runWithContext(
      {
        requestId: `job-dedupe-incremental-${contactId.slice(0, 8)}`,
        principal: null,
        scope,
      },
      () => runIncrementalCheck(scope, contactId, rid, autoMergeThreshold),
    );
  },

  /**
   * Check a whole import against the account it landed in, in one pass. The
   * corpus is built once and every new contact is matched against that
   * snapshot; one check per contact would normalize the whole corpus each time,
   * about `n × m` work.
   *
   * The new contacts are the left side of every pair. Two contacts that were
   * both already there are a full scan's job (`POST /api/dedupe/scan`).
   *
   * It is not `runScan` with another mode: `runScan` takes the instance-wide
   * run lock and clears every pending suggestion of the account first. An
   * import must not empty somebody's review queue, nor block or be blocked by a
   * scan somebody asked for. They share the matching, not the lifecycle.
   *
   * Yields to the event loop between contacts, or a large import would hold the
   * thread, and every other request, for the whole batch.
   */
  async runImportScan(
    scope: Scope,
    contactIds: string[],
    rid: string,
    options: {
      autoMergeThreshold?: number;
      onProgress?: (checked: number, total: number) => void;
    } = {},
  ): Promise<{
    autoMerged: number;
    pending: number;
    /** Imported contacts that matched something. The rest are new people. */
    matchedIds: Set<string>;
  }> {
    // The account's preset, resolved the way a scan resolves it.
    const autoMergeThreshold =
      options.autoMergeThreshold ?? autoMergeThresholdFor(scope);
    const matchedIds = new Set<string>();
    let autoMerged = 0;
    let pending = 0;

    if (contactIds.length === 0) return { autoMerged, pending, matchedIds };

    const t0 = Date.now();
    const corpus = buildIncrementalCorpus(scope, rid);
    const imported = new Set(contactIds);
    // Shared across the batch, so a pair between two of the imported contacts
    // is produced once rather than once from each end.
    const seen = new Set<string>();

    for (let i = 0; i < contactIds.length; i++) {
      if (i > 0) await new Promise<void>((resolve) => setImmediate(resolve));

      const contactId = contactIds[i];
      try {
        if (corpus.retired.has(contactId)) continue;
        const target = normalizeTarget(corpus, contactId);
        if (!target) continue;

        const pairs = findIncrementalPairs(corpus, contactId, target, seen);
        if (pairs.length === 0) continue;

        for (const pair of pairs) {
          matchedIds.add(pair.idA);
          if (imported.has(pair.idB)) matchedIds.add(pair.idB);
        }

        const counts = persistIncrementalPairs(
          corpus,
          pairs,
          rid,
          autoMergeThreshold,
        );
        autoMerged += counts.autoMerged;
        pending += counts.pending;
      } catch (err: unknown) {
        log.warn(
          "DedupeService",
          `[${rid}] Import scan failed for ${contactId}: ${getErrorMessage(err)}`,
        );
      }
      options.onProgress?.(i + 1, contactIds.length);
    }

    log.info(
      "DedupeService",
      `[${rid}] Import scan: ${contactIds.length} new contacts against ${corpus.normalized.length} existing in ${Date.now() - t0}ms at threshold ${autoMergeThreshold} — ${autoMerged} auto-merged, ${pending} pending`,
    );
    return { autoMerged, pending, matchedIds };
  },
};
