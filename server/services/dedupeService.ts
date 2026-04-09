import crypto from "crypto";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../utils/logger.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { nameSimilarity, normalizePhone } from "../utils/nlp.ts";
import { ai } from "../ai/index.ts";
import { dedupeQueue, type DedupeScanMode } from "./dedupeJobQueue.ts";

// =============================================================================
// Internal Helpers
// =============================================================================

const pairKey = (a: string, b: string) => [a, b].sort().join('::');

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
 * Returns suggestions found.
 */
function runDeterministicPass(ctx: PassContext): any[] {
  const { allContacts, contactMap, seenPairs, rid } = ctx;
  const suggestions: any[] = [];

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
    suggestions.push({
      id: pk,
      contactA: contactRepo.hydrate(contactMap.get(m.id1)),
      contactB: contactRepo.hydrate(contactMap.get(m.id2)),
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
        suggestions.push({
          id: pk,
          contactA: contactRepo.hydrate(contactMap.get(unique[i])),
          contactB: contactRepo.hydrate(contactMap.get(unique[j])),
          matchType: 'phone',
          confidence: 0.95,
          reasoning: `Both contacts share the phone number: ${origPhone}`,
          matchedField: origPhone,
        });
      }
    }
  }

  log.info("DedupeService", `[${rid}] Deterministic pass found ${suggestions.length} pair(s)`);
  return suggestions;
}

/**
 * Pass 2: Fuzzy name/company matching → batched AI evaluation.
 * Returns suggestions found.
 */
async function runAIPass(ctx: PassContext): Promise<any[]> {
  const { allContacts, contactMap, seenPairs, rid } = ctx;
  const suggestions: any[] = [];

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

    const aiResults = await evaluateBatchWithAI(fuzzyCandidates, rid);

    for (const result of aiResults) {
      const candidate = fuzzyCandidates.find(c => c.idx === result.idx);
      if (!candidate) continue;

      if (result.isDuplicate && result.confidence >= 0.6) {
        const pk = pairKey(candidate.a.id, candidate.b.id);
        seenPairs.add(pk);
        suggestions.push({
          id: pk,
          contactA: contactRepo.hydrate(candidate.a),
          contactB: contactRepo.hydrate(candidate.b),
          matchType: 'ai',
          confidence: result.confidence,
          reasoning: result.reasoning,
        });
      }
    }
  } else if (fuzzyCandidates.length > 0) {
    for (const candidate of fuzzyCandidates) {
      if (candidate.sim >= 0.80) {
        const pk = pairKey(candidate.a.id, candidate.b.id);
        suggestions.push({
          id: pk,
          contactA: contactRepo.hydrate(candidate.a),
          contactB: contactRepo.hydrate(candidate.b),
          matchType: 'ai',
          confidence: candidate.sim * 0.7,
          reasoning: `High name similarity (${(candidate.sim * 100).toFixed(0)}%)${candidate.sameCompany ? ' and same company' : ''}. AI evaluation unavailable — set GEMINI_API_KEY for smarter matching.`,
        });
      }
    }
  }

  log.info("DedupeService", `[${rid}] AI pass found ${suggestions.length} pair(s) (from ${fuzzyCandidates.length} candidates)`);
  return suggestions;
}

// =============================================================================
// Exported Service
// =============================================================================

export const dedupeService = {
  /**
   * Run a dedupe scan asynchronously, emitting progress via the queue.
   * This is the main entry point — called fire-and-forget from the route.
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

      let allSuggestions: any[] = [];

      // --- Deterministic pass ---
      if (mode === 'deterministic' || mode === 'both') {
        dedupeQueue.update(scanId, {
          phase: 'deterministic',
          phaseName: 'Scanning for exact email & phone matches…',
          contactsScanned: 0,
        });

        const deterministicResults = runDeterministicPass(ctx);
        allSuggestions.push(...deterministicResults);

        dedupeQueue.update(scanId, {
          deterministicFound: deterministicResults.length,
          contactsScanned: ctx.allContacts.length,
        });
      }

      // --- AI pass ---
      if (mode === 'ai' || mode === 'both') {
        dedupeQueue.update(scanId, {
          phase: 'ai',
          phaseName: 'Running fuzzy name analysis via Gemini…',
          contactsScanned: mode === 'both' ? ctx.allContacts.length : 0,
        });

        const aiResults = await runAIPass(ctx);
        allSuggestions.push(...aiResults);

        dedupeQueue.update(scanId, {
          aiCandidatesFound: aiResults.length,
          aiEvaluated: aiResults.length,
          contactsScanned: ctx.allContacts.length,
        });
      }

      // Sort by confidence descending
      allSuggestions.sort((a: any, b: any) => b.confidence - a.confidence);

      dedupeQueue.complete(scanId, allSuggestions);

    } catch (err: any) {
      log.error("DedupeService", `[${rid}] Scan ${scanId} failed: ${err.message}`);
      dedupeQueue.fail(scanId, err.message || 'Unknown error');
    }
  },

  mergeContacts(primaryId: string, duplicateId: string, rid: string) {
    const primary = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId) as any;
    const duplicate = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(duplicateId) as any;
    if (!primary) throw new Error(`Primary contact ${primaryId} not found`);
    if (!duplicate) throw new Error(`Duplicate contact ${duplicateId} not found`);

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

  /** @internal Dev-only seed utility. Throws in production. */
  seedDuplicates() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('seedDuplicates() is a dev-only utility and cannot run in production');
    }
    const contact1Id = crypto.randomUUID();
    const contact2Id = crypto.randomUUID();

    const insertContact = sqlite.prepare("INSERT INTO contacts (id, name, company, role, themeColor) VALUES (?, ?, ?, ?, ?)");
    const insertEmail = sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, ?, 1)");

    insertContact.run(contact1Id, "Jonathan Smith", "Acme Corp", "VP Sales", "brand");
    insertEmail.run(crypto.randomUUID(), contact1Id, "jsmith@acmecorp.com");

    insertContact.run(contact2Id, "John Smith", "Acme Corporation", "Vice President of Sales", "indigo");
    const insertPhone = sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, isPrimary) VALUES (?, ?, ?, 1)");
    insertPhone.run(crypto.randomUUID(), contact2Id, "555-0199");
  }
};
