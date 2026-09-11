import crypto from "crypto";
import { sqlite } from "../../db.ts";
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
} from "./suggestions.ts";
import { softMergeContacts, mergeContacts } from "./merging.ts";
import type { DedupeScanMode, RawPair, MatchType } from "./types.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

function resolveMode(mode: DedupeScanMode): "quick" | "deep" | "full" {
  switch (mode) {
    case "quick":
    case "deterministic":
      return "quick";
    case "full":
      return "full";
    case "deep":
    case "ai":
    case "both":
    default:
      return "deep";
  }
}

/**
 * Persist the pairs one contact produced.
 *
 * Anything at or above the auto-merge threshold is merged now and recorded as
 * `auto_merged`; everything else becomes a pending suggestion for somebody to
 * look at. A merge that throws becomes a pending suggestion too, because the
 * pair is still a pair even when the merge could not be completed.
 *
 * Returns what went where, so a batch can add up its own summary, and adds
 * every merged-away contact to `corpus.retired` so later contacts in the same
 * batch stop being offered a contact that is no longer there.
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

  const qualifying = pairs.filter((p) => p.confidence >= autoMergeThreshold);
  for (const pair of pairs) {
    if (pair.confidence >= autoMergeThreshold) continue;
    storeSuggestion(scope, pair, "pending");
    pending++;
  }

  if (qualifying.length === 0) return { autoMerged, pending };

  const ids = [...new Set(qualifying.flatMap((p) => [p.idA, p.idB]))];
  const hydrated = new Map(
    contactRepo
      .hydrateMany(contactRepo.findManyOwned(scope, ids))
      .map((c) => [c.id, c]),
  );

  for (const pair of qualifying) {
    try {
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
        pair.reasoning,
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

  return { autoMerged, pending };
}

/**
 * The body of one incremental check, inside the contact owner's context.
 *
 * Every read below names that owner: a duplicate of a contact can only be
 * another contact in the same account, so a candidate from anywhere else is
 * not a near miss, it is a leak.
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
   * Find this account's duplicates and persist them.
   *
   * The scope is an argument, not a context read. A queued scan starts long
   * after its request returned, from inside another account's completion
   * callback, so an ambient owner would be the wrong one exactly when two
   * accounts scan at once.
   */
  async runScan(
    scope: Scope,
    scanId: string,
    mode: DedupeScanMode,
    rid: string,
    autoMergeThreshold = 0.93,
  ): Promise<void> {
    dedupeQueue.setProcessing(true);
    const resolved = resolveMode(mode);
    let embeddingsReady = false;

    try {
      dedupeQueue.update(scanId, {
        phase: "normalizing",
        phaseName: "Normalizing contacts…",
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

      if (resolved !== "quick" && isEmbeddingAvailable()) {
        const existingCount = getEmbeddingCount(scope);
        const needsBackfill = resolved === "full" || existingCount === 0;

        if (needsBackfill) {
          dedupeQueue.update(scanId, {
            phase: "normalizing",
            phaseName:
              resolved === "full"
                ? "Re-embedding all contacts…"
                : "Generating contact embeddings…",
          });

          try {
            if (resolved === "full") {
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
                  phaseName: `Embedding contacts (${done}/${total})…`,
                });
              },
            );
            log.info(
              "DedupeService",
              `[${rid}] Embedding backfill: ${embedded} contacts embedded`,
            );
            // A backfill already running elsewhere makes this one a no-op that
            // returns 0. In full mode the vectors were just cleared, so
            // declaring the index ready would send the scan into a KNN over an
            // empty partition and report "no duplicates" for an account that
            // has them. Ask the store instead of trusting the count.
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
      } else if (resolved !== "quick") {
        log.warn(
          "DedupeService",
          `[${rid}] Gemini API unavailable — skipping embedding-based blocking`,
        );
      }

      const allPairs: RawPair[] = [];

      dedupeQueue.update(scanId, {
        phase: "deterministic",
        phaseName: "Scanning for exact matches (email, phone, name)…",
        contactsScanned: 0,
      });

      const deterministicResults = runDeterministicPass(ctx);
      allPairs.push(...deterministicResults);

      dedupeQueue.update(scanId, {
        deterministicFound: deterministicResults.length,
        contactsScanned: ctx.allContacts.length,
      });

      if (resolved !== "quick") {
        const funnelResults = await runFunnelPass(ctx, scanId, embeddingsReady);
        allPairs.push(...funnelResults);

        dedupeQueue.update(scanId, {
          aiCandidatesFound: funnelResults.length,
          contactsScanned: ctx.allContacts.length,
        });
      }

      dedupeQueue.update(scanId, {
        phase: "clustering",
        phaseName: "Grouping duplicates into clusters…",
        totalPairs: allPairs.length,
      });

      const clusters = buildClusters(scope, allPairs, ctx.contactMap, rid);

      dedupeQueue.update(scanId, {
        phase: "persisting",
        phaseName: "Persisting suggestions and auto-merging…",
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
            });
          }
        }
      }

      let autoMergedCount = 0;
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
            pair.reasoning,
            rid,
          );
          autoMergedCount++;
        } catch (err: unknown) {
          log.warn(
            "DedupeService",
            `[${rid}] Auto-merge failed for ${pair.idA} ↔ ${pair.idB}: ${getErrorMessage(err)}`,
          );
          pendingPairs.push(pair);
        }
      }

      if (autoMergePairs.length > 0) {
        storeSuggestions(
          scope,
          autoMergePairs.filter((_, i) => i < autoMergedCount),
          "auto_merged",
        );
      }
      if (pendingPairs.length > 0) {
        storeSuggestions(scope, pendingPairs, "pending");
      }

      log.info(
        "DedupeService",
        `[${rid}] Persisted: ${autoMergedCount} auto-merged, ${pendingPairs.length} pending suggestions`,
      );

      dedupeQueue.update(scanId, {
        autoMerged: autoMergedCount,
        pendingSuggestions: pendingPairs.length,
      });

      dedupeQueue.complete(scanId, clusters);
    } catch (err: unknown) {
      log.error(
        "DedupeService",
        `[${rid}] Scan ${scanId} failed: ${getErrorMessage(err)}`,
      );
      dedupeQueue.fail(scanId, getErrorMessage(err) || "Unknown error");
    }
  },

  /**
   * Check one just-written contact against its own account.
   *
   * A debounced timer calls this, so the request that created the contact has
   * returned and there is no context left to inherit. The owner comes off the
   * contact row, and the whole check runs inside `runWithContext`, so the AI
   * rows it writes name the right account as well as read from it.
   */
  async incrementalDedupeCheck(
    contactId: string,
    rid: string,
    autoMergeThreshold = 0.93,
  ): Promise<void> {
    const scope = scopeOfContact(contactId);
    if (!scope) {
      log.debug(
        "DedupeService",
        `[${rid}] Incremental: contact ${contactId} not found — skipping`,
      );
      return;
    }
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
   * Check a whole import against the account it landed in, in one pass.
   *
   * This replaces a loop that called `incrementalDedupeCheck` once per
   * imported contact. Each of those calls normalized the entire corpus and
   * built a whole pass context of its own, so importing `n` contacts into a
   * corpus of `m` did about `n × m` work, almost all of it the same work
   * repeated. The corpus is now built once and every new contact is matched
   * against that one snapshot.
   *
   * The new contacts are the left side of every pair. Nothing compares two
   * contacts that were both already there, which is what a full scan is for
   * and what `POST /api/dedupe/scan` still does.
   *
   * It is NOT `runScan` with another mode, though the plan describes it that
   * way. `runScan` takes the instance-wide run lock and clears every pending
   * suggestion the account has before it writes its own. An import may do
   * neither: it must not empty somebody's review queue, and it must not block
   * or be blocked by a scan somebody asked for. What `runScan` and this share
   * is the matching, not the lifecycle.
   *
   * Yields to the event loop between contacts. The per-contact work is
   * synchronous and a large import would otherwise hold the thread for the
   * whole batch, which on a shared instance is everybody else's requests.
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
    const autoMergeThreshold = options.autoMergeThreshold ?? 0.93;
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
      `[${rid}] Import scan: ${contactIds.length} new contacts against ${corpus.normalized.length} existing in ${Date.now() - t0}ms — ${autoMerged} auto-merged, ${pending} pending`,
    );
    return { autoMerged, pending, matchedIds };
  },

  seedDuplicates(scope: Scope) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "seedDuplicates() is a dev-only utility and cannot run in production",
      );
    }
    const ids = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];

    // Dev-only seed. Stamped like every other insert so the seeded rows
    // belong to whoever asked for them.
    const owner = scope.ownerId;
    const insertContact = sqlite.prepare(
      "INSERT INTO contacts (id, name, company, role, themeColor, ownerId) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertEmail = sqlite.prepare(
      "INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, ?, 1)",
    );
    const insertPhone = sqlite.prepare(
      "INSERT INTO contact_phones (id, contactId, phone, isPrimary) VALUES (?, ?, ?, 1)",
    );

    insertContact.run(
      ids[0],
      "Bobby Johnson",
      "Acme Corp",
      "VP Sales",
      "brand",
      owner,
    );
    insertPhone.run(crypto.randomUUID(), ids[0], "(555) 867-5309");

    insertContact.run(
      ids[1],
      "Robert A. Johnson",
      "Acme Corp",
      "Vice President of Sales",
      "indigo",
      owner,
    );
    insertEmail.run(crypto.randomUUID(), ids[1], "bob.johnson@gmail.com");

    insertContact.run(
      ids[2],
      "Robert Johnson",
      "Acme Corporation",
      "VP Sales",
      "violet",
      owner,
    );
    insertEmail.run(crypto.randomUUID(), ids[2], "bob.johnson@gmail.com");

    insertContact.run(ids[3], "R. Johnson", null, null, "teal", owner);
    insertPhone.run(crypto.randomUUID(), ids[3], "555-867-5309");
  },
};
