import crypto from "crypto";
import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { normalizePhone, isNicknameMatch } from "../../utils/nlp/index.ts";
import { dedupeQueue } from "./jobQueue.ts";
import { buildPassContext, getEmbeddingSimilarity } from "./context.ts";
import {
  backfillEmbeddings,
  isEmbeddingAvailable,
  getEmbeddingCount,
  getEmbedding,
  findNearestNeighbors,
  clearEmbeddingMeta,
  reEmbedStaleContacts,
} from "./embeddings.ts";
import { normalizeContacts, normalizeContactById } from "./normalization.ts";
import { loadNegativeConstraints, pairKey } from "./blocking.ts";
import {
  computeMatchSignals,
  computeCompositeScore,
  classifyPair,
  distanceToSimilarity,
} from "./scoring.ts";
import {
  runDeterministicPass,
  runFunnelPass,
  buildScoringReasoning,
} from "./passes.ts";
import { buildClusters, computePrimaryScore } from "./clustering.ts";
import {
  storeSuggestion,
  storeSuggestions,
  clearStaleSuggestions,
  clearAllPendingSuggestions,
} from "./suggestions.ts";
import { softMergeContacts, mergeContacts } from "./merging.ts";
import type {
  DedupeScanMode,
  RawPair,
  MatchType,
  NormalizedContact,
  ContactRow,
} from "./types.ts";
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

export const dedupeService = {
  mergeContacts,
  softMergeContacts,

  async runScan(
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

      const ctx = buildPassContext(rid);

      dedupeQueue.update(scanId, {
        totalContacts: ctx.allContacts.length,
        contactsScanned: 0,
      });

      if (ctx.allContacts.length < 2) {
        dedupeQueue.complete(scanId, []);
        return;
      }

      if (resolved !== "quick" && isEmbeddingAvailable()) {
        const existingCount = getEmbeddingCount();
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
              sqlite.prepare("DELETE FROM contact_embeddings").run();
              clearEmbeddingMeta();
              log.info(
                "DedupeService",
                `[${rid}] Full mode: cleared all embeddings for re-generation`,
              );
            }

            const embedded = await backfillEmbeddings((done, total, phase) => {
              dedupeQueue.update(scanId, {
                phaseName: `Embedding contacts (${done}/${total})…`,
              });
            });
            log.info(
              "DedupeService",
              `[${rid}] Embedding backfill: ${embedded} contacts embedded`,
            );
            embeddingsReady = true;
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
            const reEmbedded = await reEmbedStaleContacts();
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
            embeddingsReady = getEmbeddingCount() > 0;
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

      const clusters = buildClusters(allPairs, ctx.contactMap, rid);

      dedupeQueue.update(scanId, {
        phase: "persisting",
        phaseName: "Persisting suggestions and auto-merging…",
      });

      clearStaleSuggestions();
      clearAllPendingSuggestions();

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
      for (const pair of autoMergePairs) {
        try {
          const rawA = ctx.contactMap.get(pair.idA);
          const rawB = ctx.contactMap.get(pair.idB);
          if (!rawA || !rawB) continue;

          const scoreA = computePrimaryScore(contactRepo.hydrate(rawA));
          const scoreB = computePrimaryScore(contactRepo.hydrate(rawB));
          const [primaryId, duplicateId] =
            scoreA >= scoreB ? [pair.idA, pair.idB] : [pair.idB, pair.idA];

          dedupeService.softMergeContacts(
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
          autoMergePairs.filter((_, i) => i < autoMergedCount),
          "auto_merged",
        );
      }
      if (pendingPairs.length > 0) {
        storeSuggestions(pendingPairs, "pending");
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

  async incrementalDedupeCheck(
    contactId: string,
    rid: string,
    autoMergeThreshold = 0.93,
  ): Promise<void> {
    const t0 = Date.now();

    try {
      const target = normalizeContactById(contactId);
      if (!target) {
        log.debug(
          "DedupeService",
          `[${rid}] Incremental: contact ${contactId} not found or empty — skipping`,
        );
        return;
      }

      const distinctPairs = loadNegativeConstraints();
      const pairs: RawPair[] = [];
      const seenPairs = new Set<string>();

      if (target.emailsNorm.length > 0) {
        const placeholders = target.emailsNorm.map(() => "?").join(",");
        const emailMatches = sqlite
          .prepare(
            `
          SELECT DISTINCT ce.contactId
          FROM contact_emails ce
          JOIN contacts c ON c.id = ce.contactId
          WHERE LOWER(TRIM(ce.email)) IN (${placeholders})
            AND ce.contactId != ?
            AND c.isGhost = 0 AND (c.isArchived = 0 OR c.isArchived IS NULL) AND c.canonicalId IS NULL
        `,
          )
          .all(...target.emailsNorm, contactId) as { contactId: string }[];

        for (const match of emailMatches) {
          const pk = pairKey(contactId, match.contactId);
          if (!seenPairs.has(pk) && !distinctPairs.has(pk)) {
            seenPairs.add(pk);
            pairs.push({
              idA: contactId,
              idB: match.contactId,
              matchType: "email",
              confidence: 0.99,
              reasoning: "Shared email address",
            });
          }
        }
      }

      if (target.phonesNorm.length > 0) {
        const allPhones = sqlite
          .prepare(
            `
          SELECT contactId, phone FROM contact_phones cp
          JOIN contacts c ON c.id = cp.contactId
          WHERE cp.contactId != ? AND c.isGhost = 0 AND (c.isArchived = 0 OR c.isArchived IS NULL) AND c.canonicalId IS NULL
        `,
          )
          .all(contactId) as { contactId: string; phone: string }[];

        const targetPhoneSet = new Set(target.phonesNorm);
        for (const row of allPhones) {
          const norm = normalizePhone(row.phone);
          if (norm && targetPhoneSet.has(norm)) {
            const pk = pairKey(contactId, row.contactId);
            if (!seenPairs.has(pk) && !distinctPairs.has(pk)) {
              seenPairs.add(pk);
              pairs.push({
                idA: contactId,
                idB: row.contactId,
                matchType: "phone",
                confidence: 0.99,
                reasoning: "Shared phone number",
              });
            }
          }
        }
      }

      if (target.nameNorm) {
        const allNormalized = normalizeContacts();
        const targetBlockKeys = new Set(target.blockKeys);

        for (const other of allNormalized) {
          if (other.id === contactId) continue;
          const pk = pairKey(contactId, other.id);
          if (seenPairs.has(pk) || distinctPairs.has(pk)) continue;

          const sharesBlock = other.blockKeys.some((k) =>
            targetBlockKeys.has(k),
          );
          if (!sharesBlock) continue;

          if (target.nameNorm === other.nameNorm) {
            seenPairs.add(pk);
            const isCrossSource =
              target.sources.length > 0 &&
              other.sources.length > 0 &&
              !target.sources.some((s) => other.sources.includes(s));
            pairs.push({
              idA: contactId,
              idB: other.id,
              matchType: isCrossSource ? "cross_source" : "name",
              confidence: isCrossSource ? 0.95 : 0.92,
              reasoning: isCrossSource
                ? `Exact name match across different sources (${target.sources[0]} ↔ ${other.sources[0]})`
                : "Exact name match",
            });
            continue;
          }

          if (
            target.lastNameNorm &&
            target.lastNameNorm === other.lastNameNorm &&
            target.firstNameNorm &&
            other.firstNameNorm
          ) {
            if (isNicknameMatch(target.firstNameNorm, other.firstNameNorm)) {
              seenPairs.add(pk);
              pairs.push({
                idA: contactId,
                idB: other.id,
                matchType: "nickname",
                confidence: 0.88,
                reasoning: `Nickname match ("${target.firstNameNorm}" ↔ "${other.firstNameNorm}")`,
              });
            }
          }
        }
      }

      if (isEmbeddingAvailable()) {
        try {
          const queryVec = getEmbedding(contactId);
          if (queryVec) {
            const neighbors = findNearestNeighbors(queryVec, 5, contactId);
            const normalizedCache = new Map<string, NormalizedContact>();

            const targetSimCtx = buildPassContext(rid);

            for (const neighbor of neighbors) {
              const pk = pairKey(contactId, neighbor.contactId);
              if (seenPairs.has(pk) || distinctPairs.has(pk)) continue;

              if (!normalizedCache.has(neighbor.contactId)) {
                const n = normalizeContactById(neighbor.contactId);
                if (n) normalizedCache.set(neighbor.contactId, n);
              }
              const otherNorm = normalizedCache.get(neighbor.contactId);
              if (!otherNorm) continue;

              const pairDistinct = distinctPairs.has(pk);
              const signals = computeMatchSignals(
                target,
                otherNorm,
                distanceToSimilarity(neighbor.distance),
                pairDistinct,
                targetSimCtx.socialUrlsByContact.get(target.id) ?? [],
                targetSimCtx.socialUrlsByContact.get(otherNorm.id) ?? [],
              );
              const score = computeCompositeScore(signals);
              const classification = classifyPair(score);

              if (classification !== "discard") {
                seenPairs.add(pk);
                const rawA = sqlite
                  .prepare("SELECT * FROM contacts WHERE id = ?")
                  .get(contactId) as ContactRow | undefined;
                const rawB = sqlite
                  .prepare("SELECT * FROM contacts WHERE id = ?")
                  .get(neighbor.contactId) as ContactRow | undefined;
                pairs.push({
                  idA: contactId,
                  idB: neighbor.contactId,
                  matchType: "fuzzy",
                  confidence: score,
                  reasoning: buildScoringReasoning(signals, score, rawA, rawB),
                });
              }
            }
          }
        } catch (err: unknown) {
          log.debug(
            "DedupeService",
            `[${rid}] Incremental KNN failed: ${getErrorMessage(err)}`,
          );
        }
      }

      if (pairs.length === 0) {
        log.debug(
          "DedupeService",
          `[${rid}] Incremental: no duplicates found for ${contactId} (${Date.now() - t0}ms)`,
        );
        return;
      }

      for (const pair of pairs) {
        if (pair.confidence >= autoMergeThreshold) {
          try {
            const rawA = contactRepo.hydrate(
              sqlite
                .prepare("SELECT * FROM contacts WHERE id = ?")
                .get(pair.idA),
            );
            const rawB = contactRepo.hydrate(
              sqlite
                .prepare("SELECT * FROM contacts WHERE id = ?")
                .get(pair.idB),
            );
            const scoreA = computePrimaryScore(rawA);
            const scoreB = computePrimaryScore(rawB);
            const [primaryId, duplicateId] =
              scoreA >= scoreB ? [pair.idA, pair.idB] : [pair.idB, pair.idA];

            dedupeService.softMergeContacts(
              primaryId,
              duplicateId,
              pair.confidence,
              pair.reasoning,
              rid,
            );
            storeSuggestion(pair, "auto_merged");
          } catch (err: unknown) {
            log.warn(
              "DedupeService",
              `[${rid}] Incremental auto-merge failed: ${getErrorMessage(err)}`,
            );
            storeSuggestion(pair, "pending");
          }
        } else {
          storeSuggestion(pair, "pending");
        }
      }

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
  },

  seedDuplicates() {
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

    const insertContact = sqlite.prepare(
      "INSERT INTO contacts (id, name, company, role, themeColor) VALUES (?, ?, ?, ?, ?)",
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
    );
    insertPhone.run(crypto.randomUUID(), ids[0], "(555) 867-5309");

    insertContact.run(
      ids[1],
      "Robert A. Johnson",
      "Acme Corp",
      "Vice President of Sales",
      "indigo",
    );
    insertEmail.run(crypto.randomUUID(), ids[1], "bob.johnson@gmail.com");

    insertContact.run(
      ids[2],
      "Robert Johnson",
      "Acme Corporation",
      "VP Sales",
      "violet",
    );
    insertEmail.run(crypto.randomUUID(), ids[2], "bob.johnson@gmail.com");

    insertContact.run(ids[3], "R. Johnson", null, null, "teal");
    insertPhone.run(crypto.randomUUID(), ids[3], "555-867-5309");
  },
};
