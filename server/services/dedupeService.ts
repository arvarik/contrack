import crypto from "crypto";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../utils/logger.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { nameSimilarity, normalizePhone } from "../utils/nlp.ts";
import { ai } from "../ai/index.ts";
import { dedupeQueue, type DedupeScanMode, type DedupeCluster, type ClusterPair } from "./dedupeJobQueue.ts";
import { UnionFind } from "../utils/unionFind.ts";

// =============================================================================
// Internal Helpers
// =============================================================================

const pairKey = (a: string, b: string) => [a, b].sort().join('::');

/** Lightweight pair output from detection passes — pre-hydration. */
interface RawPair {
  idA: string;
  idB: string;
  matchType: 'email' | 'phone' | 'ai';
  confidence: number;
  reasoning: string;
  matchedField?: string;
}

/** Evaluate ALL fuzzy candidates in a single batched AI call */
async function evaluateBatchWithAI(
  candidates: { idx: number; a: any; b: any; sim: number; sameCompany: boolean }[],
  rid: string
): Promise<{ idx: number; isDuplicate: boolean; confidence: number; reasoning: string }[]> {
  if (candidates.length === 0) return [];

  const pairDescriptions = candidates.map((c) => {
    return `Pair ${c.idx}:
  Contact A: "${c.a.name}" | Company: ${c.a.company || '(none)'} | Role: ${c.a.role || '(none)'} | Location: ${c.a.location || '(none)'} | Emails: ${c.a._emails || '(none)'} | Phones: ${c.a._phones || '(none)'}
  Contact B: "${c.b.name}" | Company: ${c.b.company || '(none)'} | Role: ${c.b.role || '(none)'} | Location: ${c.b.location || '(none)'} | Emails: ${c.b._emails || '(none)'} | Phones: ${c.b._phones || '(none)'}
  Signal: Name similarity = ${(c.sim * 100).toFixed(0)}%${c.sameCompany ? ', same company' : ''}`;
  }).join('\n\n');

  try {
    const result = await ai.generate({
      systemPrompt: `You are a contact de-duplication expert for a personal CRM.
        You determine if two contact records represent the same real-world person.
        You are conservative — only flag as duplicate when genuinely confident.`,
      prompt: `For each pair below, determine if they represent the SAME real-world person.

Consider: common nickname variants (Bob/Robert, Bill/William, Mike/Michael), abbreviations, typos, and professional context (same company, role, location). Be CONSERVATIVE — only flag duplicates when genuinely confident.

${pairDescriptions}

For each pair, return your assessment. If there is clearly insufficient evidence, mark isDuplicate as false.`,
      responseFormat: "json",
      jsonSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            idx: { type: "number" },
            isDuplicate: { type: "boolean" },
            confidence: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["idx", "isDuplicate", "confidence", "reasoning"],
        },
      },
    });

    if (!result.text?.trim()) return [];
    const results = JSON.parse(result.text) as { idx: number; isDuplicate: boolean; confidence: number; reasoning: string }[];
    log.info("DedupeService", `[${rid}] AI batch evaluated ${results.length} pairs via ${result.model} in ${result.latencyMs}ms`);
    return results;
  } catch (err: any) {
    log.error("DedupeService", `[${rid}] AI batch evaluation failed: ${err.message}`);
    return [];
  }
}

// =============================================================================
// Pass Functions
// =============================================================================

interface PassContext {
  allContacts: any[];
  contactMap: Map<string, any>;
  seenPairs: Set<string>;
  rid: string;
}

function buildPassContext(rid: string): PassContext {
  const allContacts = sqlite.prepare(
    "SELECT * FROM contacts WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)"
  ).all() as any[];

  const contactMap = new Map<string, any>();
  for (const c of allContacts) contactMap.set(c.id, c);

  return { allContacts, contactMap, seenPairs: new Set(), rid };
}

/**
 * Pass 1: Deterministic — exact email and phone overlap.
 * Returns raw pairs (hydration deferred to clustering phase).
 */
function runDeterministicPass(ctx: PassContext): RawPair[] {
  const { allContacts, contactMap, seenPairs, rid } = ctx;
  const pairs: RawPair[] = [];

  if (allContacts.length < 2) {
    log.debug("DedupeService", `[${rid}] Not enough contacts to dedupe`);
    return [];
  }

  // 1a: Exact email overlap
  const emailDupes = sqlite.prepare(`
    SELECT e1.contactId AS id1, e2.contactId AS id2, e1.email AS matchedField
    FROM contact_emails e1
    JOIN contact_emails e2
      ON LOWER(TRIM(e1.email)) = LOWER(TRIM(e2.email))
    WHERE e1.contactId < e2.contactId
    GROUP BY e1.contactId, e2.contactId
  `).all() as any[];

  for (const m of emailDupes) {
    if (!contactMap.has(m.id1) || !contactMap.has(m.id2)) continue;
    const pk = pairKey(m.id1, m.id2);
    if (seenPairs.has(pk)) continue;
    seenPairs.add(pk);
    pairs.push({
      idA: m.id1,
      idB: m.id2,
      matchType: 'email',
      confidence: 0.98,
      reasoning: `Both contacts share the email address: ${m.matchedField}`,
      matchedField: m.matchedField,
    });
  }

  // 1b: Exact phone overlap
  const allPhones = sqlite.prepare("SELECT contactId, phone FROM contact_phones").all() as any[];
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
        const origPhone = allPhones.find(p => p.contactId === unique[i] && normalizePhone(p.phone) === normPhone)?.phone || normPhone;
        pairs.push({
          idA: unique[i],
          idB: unique[j],
          matchType: 'phone',
          confidence: 0.95,
          reasoning: `Both contacts share the phone number: ${origPhone}`,
          matchedField: origPhone,
        });
      }
    }
  }

  log.info("DedupeService", `[${rid}] Deterministic pass found ${pairs.length} pair(s)`);
  return pairs;
}

/** Max pairs per AI batch — balances token limits vs. API call count */
const AI_BATCH_SIZE = 50;

/** Timeout for a single AI batch call (60s) */
const AI_BATCH_TIMEOUT_MS = 60_000;

/** Wrapper that adds a timeout to an async operation */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Pass 2: Fuzzy name/company matching → batched AI evaluation.
 * Returns raw pairs (hydration deferred to clustering phase).
 *
 * AI candidates are processed in chunks of AI_BATCH_SIZE to:
 *   1. Prevent Gemini token limit overflows on large contact lists
 *   2. Keep the SSE stream alive with progress updates between batches
 *   3. Provide per-batch timeouts so a single slow call doesn't hang forever
 */
async function runAIPass(ctx: PassContext, scanId?: string): Promise<RawPair[]> {
  const { allContacts, contactMap, seenPairs, rid } = ctx;
  const pairs: RawPair[] = [];

  if (allContacts.length < 2) return [];

  // Build fuzzy candidates
  const fuzzyCandidates: { idx: number; a: any; b: any; sim: number; sameCompany: boolean }[] = [];
  let candidateIdx = 0;
  for (let i = 0; i < allContacts.length; i++) {
    for (let j = i + 1; j < allContacts.length; j++) {
      const a = allContacts[i];
      const b = allContacts[j];
      const pk = pairKey(a.id, b.id);
      if (seenPairs.has(pk)) continue;

      const sim = nameSimilarity(a.name, b.name);
      const sameCompany = !!(a.company && b.company &&
        a.company.toLowerCase().trim() === b.company.toLowerCase().trim());

      if (sim >= 0.70 || (sim >= 0.45 && sameCompany)) {
        fuzzyCandidates.push({ idx: candidateIdx++, a, b, sim, sameCompany });
      }
    }
  }

  fuzzyCandidates.sort((x, y) => y.sim - x.sim);

  if (ai.isConfigured && fuzzyCandidates.length > 0) {
    // Hydrate all candidates with emails/phones upfront
    for (const c of fuzzyCandidates) {
      const aEmails = sqlite.prepare("SELECT email FROM contact_emails WHERE contactId = ?").all(c.a.id) as any[];
      const bEmails = sqlite.prepare("SELECT email FROM contact_emails WHERE contactId = ?").all(c.b.id) as any[];
      const aPhones = sqlite.prepare("SELECT phone FROM contact_phones WHERE contactId = ?").all(c.a.id) as any[];
      const bPhones = sqlite.prepare("SELECT phone FROM contact_phones WHERE contactId = ?").all(c.b.id) as any[];
      c.a._emails = aEmails.map((e: any) => e.email).join(', ') || undefined;
      c.b._emails = bEmails.map((e: any) => e.email).join(', ') || undefined;
      c.a._phones = aPhones.map((p: any) => p.phone).join(', ') || undefined;
      c.b._phones = bPhones.map((p: any) => p.phone).join(', ') || undefined;
    }

    // Process candidates in batches of AI_BATCH_SIZE
    const totalBatches = Math.ceil(fuzzyCandidates.length / AI_BATCH_SIZE);
    log.info("DedupeService", `[${rid}] AI pass: ${fuzzyCandidates.length} candidates in ${totalBatches} batch(es)`);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const start = batchIdx * AI_BATCH_SIZE;
      const batch = fuzzyCandidates.slice(start, start + AI_BATCH_SIZE);

      // Emit progress so the SSE stream stays alive and UI updates
      if (scanId) {
        dedupeQueue.update(scanId, {
          phaseName: `Analyzing fuzzy matches… (batch ${batchIdx + 1}/${totalBatches})`,
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
          const candidate = batch.find(c => c.idx === result.idx);
          if (!candidate) continue;

          if (result.isDuplicate && result.confidence >= 0.6) {
            const pk = pairKey(candidate.a.id, candidate.b.id);
            seenPairs.add(pk);
            pairs.push({
              idA: candidate.a.id,
              idB: candidate.b.id,
              matchType: 'ai',
              confidence: result.confidence,
              reasoning: result.reasoning,
            });
          }
        }
      } catch (err: any) {
        log.warn("DedupeService", `[${rid}] AI batch ${batchIdx + 1}/${totalBatches} failed: ${err.message} — skipping batch`);
        // Continue with next batch instead of failing the entire scan
      }
    }
  } else if (fuzzyCandidates.length > 0) {
    for (const candidate of fuzzyCandidates) {
      if (candidate.sim >= 0.80) {
        const pk = pairKey(candidate.a.id, candidate.b.id);
        seenPairs.add(pk);
        pairs.push({
          idA: candidate.a.id,
          idB: candidate.b.id,
          matchType: 'ai',
          confidence: candidate.sim * 0.7,
          reasoning: `High name similarity (${(candidate.sim * 100).toFixed(0)}%)${candidate.sameCompany ? ' and same company' : ''}. AI evaluation unavailable — set GEMINI_API_KEY for smarter matching.`,
        });
      }
    }
  }

  log.info("DedupeService", `[${rid}] AI pass found ${pairs.length} pair(s) (from ${fuzzyCandidates.length} candidates)`);
  return pairs;
}

// =============================================================================
// Cluster Builder — Transitive Grouping via Union-Find
// =============================================================================

/**
 * Compute a fitness score for a contact as a primary/keeper candidate.
 * Higher score = richer record = better primary.
 *
 * Weights reflect user value:
 *   - Avatar (+10): most visually distinctive; a contact with a photo feels "real"
 *   - Interactions (+5 each): direct measure of engagement history
 *   - AI enrichment (+8): preserving expensive Gemini hydration work
 *   - Emails/phones (+3 each): core contact data richness
 *   - Scalars like role/company (+3): structural profile data
 *   - Recency (+5): prefer recently active records
 */
function computePrimaryScore(contact: any): number {
  let score = 0;

  // Data richness — prefer the most complete record
  if (contact.avatarUrl) score += 10;
  if (contact.about) score += 5;
  if (contact.role) score += 3;
  if (contact.company) score += 3;
  if (contact.location) score += 2;
  if (contact.industry) score += 2;
  if (contact.website) score += 2;

  // Child record counts (already populated by hydration)
  score += (contact.emails?.length ?? 0) * 3;
  score += (contact.phones?.length ?? 0) * 3;
  score += (contact.socialLinks?.length ?? 0) * 2;
  score += (contact.tags?.length ?? 0);
  score += (contact.education?.length ?? 0) * 2;
  score += (contact.experience?.length ?? 0) * 2;

  // Interaction history — prefer the contact the user has actively engaged with
  const row = sqlite.prepare(
    "SELECT COUNT(*) as c FROM interactions WHERE contactId = ?"
  ).get(contact.id) as any;
  score += (row?.c ?? 0) * 5;

  // Recency — prefer recently updated records
  if (contact.updatedAt) {
    const ageMs = Date.now() - new Date(contact.updatedAt).getTime();
    if (ageMs < 30 * 24 * 60 * 60 * 1000) score += 5;
  }

  // AI enrichment — strongly prefer already-enriched records
  if (contact.aiHydratedAt) score += 8;

  return score;
}

/** Select the contact with the highest primary score from a list. */
function selectBestPrimary(contacts: any[]): any {
  let best = contacts[0];
  let bestScore = computePrimaryScore(best);

  for (let i = 1; i < contacts.length; i++) {
    const score = computePrimaryScore(contacts[i]);
    if (score > bestScore) {
      best = contacts[i];
      bestScore = score;
    }
  }

  return best;
}

/**
 * Generate a human-readable summary describing why the cluster was grouped.
 * Combines deterministic signals (shared emails/phones) with AI signals
 * (similar names) into a natural-language sentence.
 */
function generateClusterSummary(contacts: any[], pairs: ClusterPair[]): string {
  const parts: string[] = [];

  // Deterministic signals
  const emailPairs = pairs.filter(p => p.matchType === 'email');
  if (emailPairs.length > 0) {
    const emails = [...new Set(emailPairs.map(p => p.matchedField).filter(Boolean))];
    parts.push(`shared email${emails.length > 1 ? 's' : ''} ${emails.join(', ')}`);
  }

  const phonePairs = pairs.filter(p => p.matchType === 'phone');
  if (phonePairs.length > 0) {
    const phones = [...new Set(phonePairs.map(p => p.matchedField).filter(Boolean))];
    parts.push(`shared phone${phones.length > 1 ? 's' : ''} ${phones.join(', ')}`);
  }

  // AI signals
  const aiPairs = pairs.filter(p => p.matchType === 'ai');
  if (aiPairs.length > 0) {
    const names = [...new Set(contacts.map(c => c.name))];
    if (names.length > 1) {
      parts.push(`similar names (${names.join(' \u2194 ')})`);
    }
  }

  if (parts.length === 0) {
    return `${contacts.length} contacts may represent the same person.`;
  }

  return `These ${contacts.length} contacts have ${parts.join(' and ')}.`;
}

/**
 * Group detected pairs into clusters using Union-Find transitive closure.
 *
 * Given pairs: (A,B), (B,C), (D,E) this produces two clusters:
 *   Cluster 1: {A, B, C}
 *   Cluster 2: {D, E}
 *
 * Each cluster is enriched with:
 *   - Hydrated contacts (each contact hydrated exactly once — perf win over pairwise)
 *   - Auto-selected best primary based on data richness heuristic
 *   - Aggregate confidence and weak-link detection
 *   - Human-readable summary
 */
function buildClusters(
  pairs: RawPair[],
  contactMap: Map<string, any>,
  rid: string,
): DedupeCluster[] {
  if (pairs.length === 0) return [];

  // Phase 1: Build Union-Find from all pair edges
  const uf = new UnionFind();
  for (const pair of pairs) {
    uf.union(pair.idA, pair.idB);
  }

  // Phase 2: Get grouped clusters (root → member IDs)
  const clusterGroups = uf.getClusters();

  // Phase 3: Enrich each cluster
  const clusters: DedupeCluster[] = [];

  for (const [, memberIds] of clusterGroups) {
    // Hydrate all contacts in this cluster — each contact hydrated exactly once
    const contacts = memberIds
      .map(id => contactMap.get(id))
      .filter(Boolean)
      .map(raw => contactRepo.hydrate(raw));

    if (contacts.length < 2) continue;

    // Collect pairs belonging to this cluster (check via shared root)
    const clusterRoot = uf.find(memberIds[0]);
    const clusterPairs: ClusterPair[] = pairs
      .filter(p => uf.find(p.idA) === clusterRoot)
      .map(p => ({
        contactIdA: p.idA,
        contactIdB: p.idB,
        matchType: p.matchType,
        confidence: p.confidence,
        reasoning: p.reasoning,
        matchedField: p.matchedField,
      }));

    // Auto-select the richest contact as the suggested primary
    const primary = selectBestPrimary(contacts);

    // Confidence statistics
    const confidences = clusterPairs.map(p => p.confidence);
    const aggregateConfidence = Math.max(...confidences);
    const minConfidence = Math.min(...confidences);

    clusters.push({
      id: crypto.randomUUID(),
      contacts,
      suggestedPrimaryId: primary.id,
      pairs: clusterPairs,
      aggregateConfidence,
      summary: generateClusterSummary(contacts, clusterPairs),
      size: contacts.length,
      hasWeakLink: minConfidence < 0.60,
      minConfidence,
    });
  }

  // Sort by aggregate confidence descending (highest-confidence clusters first)
  clusters.sort((a, b) => b.aggregateConfidence - a.aggregateConfidence);

  log.info("DedupeService", `[${rid}] Clustered ${pairs.length} pair(s) into ${clusters.length} cluster(s)`);
  return clusters;
}

// =============================================================================
// Exported Service
// =============================================================================

export const dedupeService = {
  /**
   * Run a dedupe scan asynchronously, emitting progress via the queue.
   * Detects duplicate pairs, then groups them into clusters via Union-Find.
   */
  async runScan(scanId: string, mode: DedupeScanMode, rid: string): Promise<void> {
    dedupeQueue.setProcessing(true);

    try {
      const ctx = buildPassContext(rid);

      dedupeQueue.update(scanId, {
        totalContacts: ctx.allContacts.length,
        contactsScanned: 0,
      });

      if (ctx.allContacts.length < 2) {
        dedupeQueue.complete(scanId, []);
        return;
      }

      const allPairs: RawPair[] = [];

      // --- Deterministic pass ---
      if (mode === 'deterministic' || mode === 'both') {
        dedupeQueue.update(scanId, {
          phase: 'deterministic',
          phaseName: 'Scanning for exact email & phone matches\u2026',
          contactsScanned: 0,
        });

        const deterministicResults = runDeterministicPass(ctx);
        allPairs.push(...deterministicResults);

        dedupeQueue.update(scanId, {
          deterministicFound: deterministicResults.length,
          contactsScanned: ctx.allContacts.length,
        });
      }

      // --- AI pass ---
      if (mode === 'ai' || mode === 'both') {
        dedupeQueue.update(scanId, {
          phase: 'ai',
          phaseName: 'Running fuzzy name analysis via Gemini\u2026',
          contactsScanned: mode === 'both' ? ctx.allContacts.length : 0,
        });

        const aiResults = await runAIPass(ctx, scanId);
        allPairs.push(...aiResults);

        dedupeQueue.update(scanId, {
          aiCandidatesFound: aiResults.length,
          aiEvaluated: aiResults.length,
          contactsScanned: ctx.allContacts.length,
        });
      }

      // --- Clustering pass ---
      dedupeQueue.update(scanId, {
        phase: 'clustering',
        phaseName: 'Grouping duplicates into clusters\u2026',
        totalPairs: allPairs.length,
      });

      const clusters = buildClusters(allPairs, ctx.contactMap, rid);

      dedupeQueue.complete(scanId, clusters);

    } catch (err: any) {
      log.error("DedupeService", `[${rid}] Scan ${scanId} failed: ${err.message}`);
      dedupeQueue.fail(scanId, err.message || 'Unknown error');
    }
  },

  mergeContacts(primaryId: string, duplicateId: string, rid: string) {
    const primary = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId) as any;
    const duplicate = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(duplicateId) as any;

    // Hard guard: primary must exist — this is a real error
    if (!primary) {
      throw new Error(`Primary contact ${primaryId} not found — it may have been deleted`);
    }

    // Soft guard: duplicate already gone — idempotent (e.g., concurrent merge or re-scan)
    if (!duplicate) {
      log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} already deleted, skipping merge into ${primaryId}`);
      return contactRepo.hydrate(primary);
    }

    const mergeTxn = sqlite.transaction(() => {
      sqlite.prepare("UPDATE interactions SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);
      
      sqlite.prepare(`
        UPDATE interaction_mentions SET contactId = ?
        WHERE contactId = ? AND interactionId NOT IN (
          SELECT interactionId FROM interaction_mentions WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);
      sqlite.prepare("DELETE FROM interaction_mentions WHERE contactId = ?").run(duplicateId);

      sqlite.prepare(`
        UPDATE contact_emails SET contactId = ?
        WHERE contactId = ? AND LOWER(TRIM(email)) NOT IN (
          SELECT LOWER(TRIM(email)) FROM contact_emails WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      const primaryPhones = sqlite.prepare("SELECT phone FROM contact_phones WHERE contactId = ?").all(primaryId) as any[];
      const primaryPhoneNorms = new Set(primaryPhones.map((p: any) => normalizePhone(p.phone)));
      const dupePhones = sqlite.prepare("SELECT id, phone FROM contact_phones WHERE contactId = ?").all(duplicateId) as any[];
      for (const dp of dupePhones) {
        if (!primaryPhoneNorms.has(normalizePhone(dp.phone))) {
          sqlite.prepare("UPDATE contact_phones SET contactId = ? WHERE id = ?").run(primaryId, dp.id);
        }
      }

      sqlite.prepare(`
        UPDATE contact_social_links SET contactId = ?
        WHERE contactId = ? AND (platform || '::' || LOWER(TRIM(url))) NOT IN (
          SELECT platform || '::' || LOWER(TRIM(url)) FROM contact_social_links WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      const primaryEdu = sqlite.prepare("SELECT school, degree FROM contact_education WHERE contactId = ?").all(primaryId) as any[];
      const primaryEduKeys = new Set(primaryEdu.map((e: any) => `${(e.school || '').toLowerCase().trim()}::${(e.degree || '').toLowerCase().trim()}`));
      const dupeEdu = sqlite.prepare("SELECT id, school, degree FROM contact_education WHERE contactId = ?").all(duplicateId) as any[];
      for (const edu of dupeEdu) {
        const key = `${(edu.school || '').toLowerCase().trim()}::${(edu.degree || '').toLowerCase().trim()}`;
        if (!primaryEduKeys.has(key)) {
          sqlite.prepare("UPDATE contact_education SET contactId = ? WHERE id = ?").run(primaryId, edu.id);
        }
      }

      const primaryExp = sqlite.prepare("SELECT company, role FROM contact_experience WHERE contactId = ?").all(primaryId) as any[];
      const primaryExpKeys = new Set(primaryExp.map((e: any) => `${(e.company || '').toLowerCase().trim()}::${(e.role || '').toLowerCase().trim()}`));
      const dupeExp = sqlite.prepare("SELECT id, company, role FROM contact_experience WHERE contactId = ?").all(duplicateId) as any[];
      for (const exp of dupeExp) {
        const key = `${(exp.company || '').toLowerCase().trim()}::${(exp.role || '').toLowerCase().trim()}`;
        if (!primaryExpKeys.has(key)) {
          sqlite.prepare("UPDATE contact_experience SET contactId = ? WHERE id = ?").run(primaryId, exp.id);
        }
      }

      const primarySrc = sqlite.prepare("SELECT platform, externalId FROM contact_sources WHERE contactId = ?").all(primaryId) as any[];
      const primarySrcKeys = new Set(primarySrc.map((s: any) => `${(s.platform || '').toLowerCase().trim()}::${(s.externalId || '').toLowerCase().trim()}`));
      const dupeSrc = sqlite.prepare("SELECT id, platform, externalId FROM contact_sources WHERE contactId = ?").all(duplicateId) as any[];
      for (const src of dupeSrc) {
        const key = `${(src.platform || '').toLowerCase().trim()}::${(src.externalId || '').toLowerCase().trim()}`;
        if (!primarySrcKeys.has(key)) {
          sqlite.prepare("UPDATE contact_sources SET contactId = ? WHERE id = ?").run(primaryId, src.id);
        }
      }

      sqlite.prepare(`
        UPDATE contact_tags SET contactId = ?
        WHERE contactId = ? AND LOWER(TRIM(tag)) NOT IN (
          SELECT LOWER(TRIM(tag)) FROM contact_tags WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      sqlite.prepare(`
        UPDATE contact_interests SET contactId = ?
        WHERE contactId = ? AND LOWER(TRIM(interest)) NOT IN (
          SELECT LOWER(TRIM(interest)) FROM contact_interests WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      sqlite.prepare(`
        UPDATE contact_attributes SET contactId = ?
        WHERE contactId = ? AND LOWER(TRIM(name)) NOT IN (
          SELECT LOWER(TRIM(name)) FROM contact_attributes WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      sqlite.prepare(`
        UPDATE contact_addresses SET contactId = ?
        WHERE contactId = ? AND LOWER(TRIM(address)) NOT IN (
          SELECT LOWER(TRIM(address)) FROM contact_addresses WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      const scalarFields = [
        'firstName', 'lastName', 'headline', 'role', 'company', 'location',
        'birthday', 'preferences', 'avatarUrl', 'about', 'pronouns',
        'industry', 'website', 'lat', 'lng',
        // AI-generated fields — preserve hydration status when merging
        'aiHydratedAt', 'aiBriefing', 'aiBackground', 'aiSummary', 'aiBriefingAt',
      ];
      const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
      for (const field of scalarFields) {
        if (!primary[field] && duplicate[field]) {
          updates[field] = duplicate[field];
        }
      }

      const dupLists = sqlite.prepare("SELECT listId FROM list_members WHERE contactId = ?").all(duplicateId) as { listId: string }[];
      const insertMember = sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)");
      for (const dl of dupLists) {
        insertMember.run(dl.listId, primaryId);
      }

      if (duplicate.addedAt && (!primary.addedAt || duplicate.addedAt < primary.addedAt)) {
        updates.addedAt = duplicate.addedAt;
      }

      db.update(schema.contacts).set(updates).where(eq(schema.contacts.id, primaryId)).run();
      sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(duplicateId);
    });

    mergeTxn();
    return contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId));
  },

  /** @internal Dev-only seed utility — creates a 4-contact cluster for testing. */
  seedDuplicates() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('seedDuplicates() is a dev-only utility and cannot run in production');
    }
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

    const insertContact = sqlite.prepare("INSERT INTO contacts (id, name, company, role, themeColor) VALUES (?, ?, ?, ?, ?)");
    const insertEmail = sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, ?, 1)");
    const insertPhone = sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, isPrimary) VALUES (?, ?, ?, 1)");

    // Contact 1: "Bobby Johnson" — Apple (has phone)
    insertContact.run(ids[0], "Bobby Johnson", "Acme Corp", "VP Sales", "brand");
    insertPhone.run(crypto.randomUUID(), ids[0], "(555) 867-5309");

    // Contact 2: "Robert A. Johnson" — Google (has shared email with #3)
    insertContact.run(ids[1], "Robert A. Johnson", "Acme Corp", "Vice President of Sales", "indigo");
    insertEmail.run(crypto.randomUUID(), ids[1], "bob.johnson@gmail.com");

    // Contact 3: "Robert Johnson" — LinkedIn (shared email with #2)
    insertContact.run(ids[2], "Robert Johnson", "Acme Corporation", "VP Sales", "violet");
    insertEmail.run(crypto.randomUUID(), ids[2], "bob.johnson@gmail.com");

    // Contact 4: "R. Johnson" — Manual (shared phone with #1)
    insertContact.run(ids[3], "R. Johnson", null, null, "teal");
    insertPhone.run(crypto.randomUUID(), ids[3], "555-867-5309");
  }
};
