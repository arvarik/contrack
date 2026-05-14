import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { ai } from "../../ai/index.ts";
import { dedupeQueue } from "./jobQueue.ts";
import {
  normalizePhone,
  normalizeCompany,
  isNicknameMatch,
} from "../../utils/nlp/index.ts";
import {
  buildBlockIndex,
  generateCandidatePairs,
  addEmbeddingCandidates,
  isKnownDistinct,
  pairKey,
} from "./blocking.ts";
import { getEmbeddingSimilarity } from "./context.ts";
import {
  computeMatchSignals,
  computeCompositeScore,
  classifyPair,
} from "./scoring.ts";
import { evaluateBatchWithAI } from "./ai.ts";
import type { RawPair, PassContext, MatchSignals } from "./types.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

const MEGA_BLOCK_THRESHOLD = 100;
const AI_BATCH_SIZE = 12;
const AI_BATCH_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function buildScoringReasoning(
  signals: MatchSignals,
  score: number,
  rawA: any,
  rawB: any,
): string {
  const parts: string[] = [];

  if (signals.nameExactMatch) parts.push(`exact name match`);
  else if (signals.nicknameMatch)
    parts.push(`nickname match ("${rawA?.name}" ↔ "${rawB?.name}")`);
  else if (signals.nameJaroWinkler >= 0.85)
    parts.push(
      `high name similarity (${(signals.nameJaroWinkler * 100).toFixed(0)}%)`,
    );

  if (signals.nameMetaphoneMatch) parts.push("phonetically similar");
  if (signals.companyMatch) parts.push("same company");
  if (signals.locationOverlap) parts.push("same location");
  if (signals.isCrossSource) parts.push("different import sources");
  if (signals.embeddingSimilarity > 0.5)
    parts.push(
      `embedding similarity ${(signals.embeddingSimilarity * 100).toFixed(0)}%`,
    );

  const reasoning =
    parts.length > 0
      ? parts.join(", ")
      : `composite score ${(score * 100).toFixed(0)}%`;
  return `${reasoning.charAt(0).toUpperCase()}${reasoning.slice(1)} (score: ${(score * 100).toFixed(0)}%)`;
}

export function runDeterministicPass(ctx: PassContext): RawPair[] {
  const { contactMap, seenPairs, rid, normalizedMap } = ctx;
  const pairs: RawPair[] = [];

  if (ctx.allContacts.length < 2) {
    log.debug("DedupeService", `[${rid}] Not enough contacts to dedupe`);
    return [];
  }

  // D1: Exact email
  const emailDupes = sqlite
    .prepare(
      `
    SELECT e1.contactId AS id1, e2.contactId AS id2, e1.email AS matchedField
    FROM contact_emails e1
    JOIN contact_emails e2
      ON LOWER(TRIM(e1.email)) = LOWER(TRIM(e2.email))
    WHERE e1.contactId < e2.contactId
    GROUP BY e1.contactId, e2.contactId
  `,
    )
    .all() as any[];

  for (const m of emailDupes) {
    if (!contactMap.has(m.id1) || !contactMap.has(m.id2)) continue;
    const pk = pairKey(m.id1, m.id2);
    if (seenPairs.has(pk)) continue;
    seenPairs.add(pk);
    pairs.push({
      idA: m.id1,
      idB: m.id2,
      matchType: "email",
      confidence: 0.98,
      reasoning: `Shared email address: ${m.matchedField}`,
      matchedField: m.matchedField,
    });
  }

  // D2: Exact phone
  const allPhones = sqlite
    .prepare("SELECT contactId, phone FROM contact_phones")
    .all() as any[];
  const phoneMap = new Map<string, string[]>();
  for (const p of allPhones) {
    if (!contactMap.has(p.contactId)) continue;
    const norm = normalizePhone(p.phone);
    if (norm.length < 7) continue;
    if (!phoneMap.has(norm)) phoneMap.set(norm, []);
    phoneMap.get(norm)!.push(p.contactId);
  }
  for (const [normPhone, contactIds] of phoneMap) {
    const unique = [...new Set(contactIds)];
    if (unique.length < 2) continue;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const pk = pairKey(unique[i], unique[j]);
        if (seenPairs.has(pk)) continue;
        seenPairs.add(pk);
        const origPhone =
          allPhones.find(
            (p) =>
              p.contactId === unique[i] &&
              normalizePhone(p.phone) === normPhone,
          )?.phone || normPhone;
        pairs.push({
          idA: unique[i],
          idB: unique[j],
          matchType: "phone",
          confidence: 0.95,
          reasoning: `Shared phone number: ${origPhone}`,
          matchedField: origPhone,
        });
      }
    }
  }

  // D3: Exact name match
  const nameDupes = sqlite
    .prepare(
      `
    SELECT c1.id AS id1, c2.id AS id2, c1.name AS name1, c2.name AS name2
    FROM contacts c1
    JOIN contacts c2
      ON LOWER(TRIM(c1.name)) = LOWER(TRIM(c2.name))
      AND c1.id < c2.id
    WHERE c1.isGhost = 0 AND c2.isGhost = 0
      AND (c1.isArchived = 0 OR c1.isArchived IS NULL)
      AND (c2.isArchived = 0 OR c2.isArchived IS NULL)
      AND c1.canonicalId IS NULL AND c2.canonicalId IS NULL
  `,
    )
    .all() as any[];

  const allSources = sqlite
    .prepare("SELECT contactId, platform FROM contact_sources")
    .all() as { contactId: string; platform: string }[];
  const sourcesByContact = new Map<string, Set<string>>();
  for (const s of allSources) {
    if (!sourcesByContact.has(s.contactId))
      sourcesByContact.set(s.contactId, new Set());
    sourcesByContact.get(s.contactId)!.add(s.platform.toLowerCase());
  }

  for (const m of nameDupes) {
    if (!contactMap.has(m.id1) || !contactMap.has(m.id2)) continue;
    const pk = pairKey(m.id1, m.id2);
    if (seenPairs.has(pk)) continue;

    const nA = normalizedMap.get(m.id1);
    const nB = normalizedMap.get(m.id2);
    const companyA =
      nA?.companyNorm ?? normalizeCompany(contactMap.get(m.id1)?.company ?? "");
    const companyB =
      nB?.companyNorm ?? normalizeCompany(contactMap.get(m.id2)?.company ?? "");
    const sameCompany =
      companyA.length > 1 && companyB.length > 1 && companyA === companyB;

    const srcA = sourcesByContact.get(m.id1);
    const srcB = sourcesByContact.get(m.id2);
    const isCrossSource =
      srcA &&
      srcB &&
      srcA.size > 0 &&
      srcB.size > 0 &&
      ![...srcA].some((s) => srcB.has(s));

    seenPairs.add(pk);

    if (sameCompany) {
      pairs.push({
        idA: m.id1,
        idB: m.id2,
        matchType: "name_company",
        confidence: 0.95,
        reasoning: `Exact name match "${m.name1}" with same company`,
      });
    } else if (isCrossSource) {
      pairs.push({
        idA: m.id1,
        idB: m.id2,
        matchType: "cross_source",
        confidence: 0.92,
        reasoning: `Exact name match "${m.name1}" from different sources (${[...srcA!].join(", ")} ↔ ${[...srcB!].join(", ")})`,
      });
    } else {
      pairs.push({
        idA: m.id1,
        idB: m.id2,
        matchType: "name",
        confidence: 0.9,
        reasoning: `Exact name match: "${m.name1}"`,
      });
    }
  }

  // D5: Nickname-equivalent name
  const lastNameGroups = new Map<string, any[]>();
  for (const n of ctx.normalized) {
    if (n.lastNameNorm.length < 2) continue;
    if (!lastNameGroups.has(n.lastNameNorm))
      lastNameGroups.set(n.lastNameNorm, []);
    lastNameGroups.get(n.lastNameNorm)!.push(n);
  }

  for (const [, group] of lastNameGroups) {
    if (group.length < 2 || group.length > MEGA_BLOCK_THRESHOLD) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const pk = pairKey(a.id, b.id);
        if (seenPairs.has(pk)) continue;

        if (a.nameNorm === b.nameNorm) continue;

        if (isNicknameMatch(a.nameTokens.join(" "), b.nameTokens.join(" "))) {
          seenPairs.add(pk);
          const rawA = contactMap.get(a.id);
          const rawB = contactMap.get(b.id);
          pairs.push({
            idA: a.id,
            idB: b.id,
            matchType: "nickname",
            confidence: 0.88,
            reasoning: `Nickname match: "${rawA?.name}" ↔ "${rawB?.name}"`,
          });
        }
      }
    }
  }

  const d1d2 = pairs.filter(
    (p) => p.matchType === "email" || p.matchType === "phone",
  ).length;
  const d3d6 = pairs.length - d1d2;
  log.info(
    "DedupeService",
    `[${rid}] Deterministic pass: ${pairs.length} pairs (D1/D2: ${d1d2}, D3–D6: ${d3d6})`,
  );
  return pairs;
}

export async function runFunnelPass(
  ctx: PassContext,
  scanId?: string,
  useEmbeddings = true,
): Promise<RawPair[]> {
  const { normalized, normalizedMap, seenPairs, distinctPairs, rid } = ctx;
  const pairs: RawPair[] = [];

  if (normalized.length < 2) return [];

  // 1: Blocks
  if (scanId) {
    dedupeQueue.update(scanId, {
      phase: "blocking",
      phaseName: "Building candidate blocks…",
    });
  }

  const blockIndex = buildBlockIndex(normalized);
  const { candidates: blockCandidates, stats } = generateCandidatePairs(
    blockIndex,
    seenPairs,
  );
  log.info(
    "DedupeService",
    `[${rid}] Blocking: ${normalized.length} -> ${stats.totalCandidates} candidates`,
  );

  // 2+3: Embedding KNN + Merge candidates
  const allCandidateKeys = new Set<string>();
  const allCandidates: { idA: string; idB: string }[] = [];

  for (const c of blockCandidates) {
    const pk = pairKey(c.idA, c.idB);
    if (!allCandidateKeys.has(pk)) {
      allCandidateKeys.add(pk);
      allCandidates.push(c);
    }
  }

  if (useEmbeddings) {
    const contactIds = normalized.map((c) => c.id);
    const embeddingCandidates = addEmbeddingCandidates(contactIds, seenPairs);
    for (const c of embeddingCandidates) {
      const pk = pairKey(c.idA, c.idB);
      if (!allCandidateKeys.has(pk) && !seenPairs.has(pk)) {
        allCandidateKeys.add(pk);
        allCandidates.push(c);
      }
    }
  } else {
    log.info(
      "DedupeService",
      `[${rid}] Skipping embedding KNN — embeddings unavailable`,
    );
  }

  if (scanId) {
    dedupeQueue.update(scanId, {
      blockingCandidates: allCandidates.length,
      phaseName: `Scoring ${allCandidates.length} candidate pairs…`,
      phase: "scoring",
    });
  }

  // 4+5: Score
  const aiQueue: {
    pair: { idA: string; idB: string };
    signals: MatchSignals;
    score: number;
  }[] = [];
  let autoCount = 0;
  let discardCount = 0;

  for (const candidate of allCandidates) {
    const nA = normalizedMap.get(candidate.idA);
    const nB = normalizedMap.get(candidate.idB);
    if (!nA || !nB) continue;

    const distinct = isKnownDistinct(
      candidate.idA,
      candidate.idB,
      distinctPairs,
    );
    const embSim = getEmbeddingSimilarity(candidate.idA, candidate.idB, ctx);

    const signals = computeMatchSignals(
      nA,
      nB,
      embSim,
      distinct,
      ctx.socialUrlsByContact.get(candidate.idA) ?? [],
      ctx.socialUrlsByContact.get(candidate.idB) ?? [],
    );

    const score = computeCompositeScore(signals);
    const classification = classifyPair(score);

    if (classification === "auto") {
      seenPairs.add(pairKey(candidate.idA, candidate.idB));
      const rawA = ctx.contactMap.get(candidate.idA);
      const rawB = ctx.contactMap.get(candidate.idB);
      pairs.push({
        idA: candidate.idA,
        idB: candidate.idB,
        matchType: "fuzzy",
        confidence: score,
        reasoning: buildScoringReasoning(signals, score, rawA, rawB),
      });
      autoCount++;
    } else if (classification === "ai") {
      aiQueue.push({ pair: candidate, signals, score });
    } else {
      discardCount++;
    }
  }

  if (scanId) {
    dedupeQueue.update(scanId, {
      scoringAutoMerge: autoCount,
      scoringAiQueue: aiQueue.length,
      scoringDiscarded: discardCount,
    });
  }

  // 6: AI
  if (aiQueue.length > 0 && ai.isConfigured) {
    if (scanId) {
      dedupeQueue.update(scanId, {
        phase: "ai",
        phaseName: `Verifying ${aiQueue.length} ambiguous pairs via AI…`,
      });
    }

    const aiCandidates = aiQueue.map((item, idx) => ({
      idx,
      a: ctx.contactMap.get(item.pair.idA),
      b: ctx.contactMap.get(item.pair.idB),
      nA: normalizedMap.get(item.pair.idA)!,
      nB: normalizedMap.get(item.pair.idB)!,
      signals: item.signals,
      score: item.score,
    }));

    const totalBatches = Math.ceil(aiCandidates.length / AI_BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const start = batchIdx * AI_BATCH_SIZE;
      const batch = aiCandidates.slice(start, start + AI_BATCH_SIZE);

      if (scanId) {
        dedupeQueue.update(scanId, {
          phaseName: `AI verification batch ${batchIdx + 1}/${totalBatches}…`,
          aiEvaluated: start,
        });
      }

      try {
        const aiResults = await withTimeout(
          evaluateBatchWithAI(batch, rid),
          AI_BATCH_TIMEOUT_MS,
          `AI batch ${batchIdx + 1}/${totalBatches}`,
        );

        for (const result of aiResults) {
          if (result.isDuplicate && result.confidence >= 0.6) {
            const candidate = batch.find((c) => c.idx === result.idx);
            if (!candidate) continue;

            const pk = pairKey(candidate.a.id, candidate.b.id);
            seenPairs.add(pk);
            pairs.push({
              idA: candidate.a.id,
              idB: candidate.b.id,
              matchType: "ai",
              confidence: result.confidence,
              reasoning: result.reasoning,
            });
          }
        }
      } catch (err: unknown) {
        log.warn(
          "DedupeService",
          `[${rid}] AI batch failed: ${getErrorMessage(err)}`,
        );
        for (const candidate of batch) {
          if (candidate.score >= 0.8) {
            const pk = pairKey(candidate.a.id, candidate.b.id);
            seenPairs.add(pk);
            pairs.push({
              idA: candidate.a.id,
              idB: candidate.b.id,
              matchType: "fuzzy",
              confidence: candidate.score * 0.85,
              reasoning: `High composite score (${(candidate.score * 100).toFixed(0)}%). AI unavailable.`,
            });
          }
        }
      }
    }
  } else if (aiQueue.length > 0) {
    for (const item of aiQueue) {
      if (item.score >= 0.75) {
        const rawA = ctx.contactMap.get(item.pair.idA);
        const rawB = ctx.contactMap.get(item.pair.idB);
        seenPairs.add(pairKey(item.pair.idA, item.pair.idB));
        pairs.push({
          idA: item.pair.idA,
          idB: item.pair.idB,
          matchType: "fuzzy",
          confidence: item.score * 0.7,
          reasoning: `${buildScoringReasoning(item.signals, item.score, rawA, rawB)} (AI unavailable)`,
        });
      }
    }
  }

  return pairs;
}
