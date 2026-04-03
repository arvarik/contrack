import { Router } from "express";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { GoogleGenAI, Type } from "@google/genai";
import { log } from "../logger.ts";
import { hydrateContact, nameSimilarity, normalizePhone } from "../helpers.ts";

const genai = new GoogleGenAI({});
const router = Router();

// =======================================================================
// Dedupe API: The Singularity
// =======================================================================

router.get("/dedupe/suggestions", async (req, res) => {
  const rid = (req as any).requestId;
  try {
    const allContacts = sqlite.prepare("SELECT * FROM contacts").all() as any[];
    if (allContacts.length < 2) {
      log.debug("Dedupe", `[${rid}] Not enough contacts to dedupe`);
      return res.json([]);
    }

    const suggestions: any[] = [];
    const seenPairs = new Set<string>();
    const pairKey = (a: string, b: string) => [a, b].sort().join('::');

    // ----- Pass 1: Deterministic — exact email overlap -----
    const emailDupes = sqlite.prepare(`
      SELECT e1.contactId AS id1, e2.contactId AS id2, e1.email AS matchedField
      FROM contact_emails e1
      JOIN contact_emails e2
        ON LOWER(TRIM(e1.email)) = LOWER(TRIM(e2.email))
      WHERE e1.contactId < e2.contactId
      GROUP BY e1.contactId, e2.contactId
    `).all() as any[];

    for (const m of emailDupes) {
      const pk = pairKey(m.id1, m.id2);
      if (seenPairs.has(pk)) continue;
      seenPairs.add(pk);
      suggestions.push({
        id: pk,
        contactA: hydrateContact(allContacts.find((c: any) => c.id === m.id1)),
        contactB: hydrateContact(allContacts.find((c: any) => c.id === m.id2)),
        matchType: 'email',
        confidence: 0.98,
        reasoning: `Both contacts share the email address: ${m.matchedField}`,
        matchedField: m.matchedField,
      });
    }

    // ----- Pass 1b: Deterministic — exact phone overlap (normalized) -----
    const allPhones = sqlite.prepare("SELECT contactId, phone FROM contact_phones").all() as any[];
    const phoneMap = new Map<string, string[]>();
    for (const p of allPhones) {
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
            contactA: hydrateContact(allContacts.find((c: any) => c.id === unique[i])),
            contactB: hydrateContact(allContacts.find((c: any) => c.id === unique[j])),
            matchType: 'phone',
            confidence: 0.95,
            reasoning: `Both contacts share the phone number: ${origPhone}`,
            matchedField: origPhone,
          });
        }
      }
    }

    // ----- Pass 2: Fuzzy name/company matching → AI evaluation -----
    const fuzzyCandidates: { a: any; b: any; sim: number; sameCompany: boolean }[] = [];
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
          fuzzyCandidates.push({ a, b, sim, sameCompany });
        }
      }
    }

    fuzzyCandidates.sort((x, y) => y.sim - x.sim);
    const aiCandidates = fuzzyCandidates.slice(0, 15);

    if (process.env.GEMINI_API_KEY && aiCandidates.length > 0) {
      log.info("Dedupe", `[${rid}] AI pass: evaluating ${aiCandidates.length} fuzzy candidates`);

      for (const candidate of aiCandidates) {
        try {
          const aHydrated = hydrateContact(candidate.a);
          const bHydrated = hydrateContact(candidate.b);

          const prompt = `You are a contact de-duplication expert. Determine if these two CRM records represent the SAME real-world person.

Contact A:
  Name: ${candidate.a.name}
  Company: ${candidate.a.company || '(none)'}
  Role: ${candidate.a.role || '(none)'}
  Headline: ${candidate.a.headline || '(none)'}
  Location: ${candidate.a.location || '(none)'}
  Emails: ${aHydrated.emails?.map((e: any) => e.email).join(', ') || '(none)'}
  Phones: ${aHydrated.phones?.map((p: any) => p.phone).join(', ') || '(none)'}

Contact B:
  Name: ${candidate.b.name}
  Company: ${candidate.b.company || '(none)'}
  Role: ${candidate.b.role || '(none)'}
  Headline: ${candidate.b.headline || '(none)'}
  Location: ${candidate.b.location || '(none)'}
  Emails: ${bHydrated.emails?.map((e: any) => e.email).join(', ') || '(none)'}
  Phones: ${bHydrated.phones?.map((p: any) => p.phone).join(', ') || '(none)'}

Flagged because: Name similarity = ${(candidate.sim * 100).toFixed(0)}%${candidate.sameCompany ? ', same company' : ''}

Consider nickname variants (Bob/Robert, Bill/William, J./Julian), abbreviations, and professional context. Be conservative — only confirm duplicates you are confident about.`;

          const response = await genai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  isDuplicate: { type: Type.BOOLEAN },
                  confidence: { type: Type.NUMBER },
                  reasoning: { type: Type.STRING },
                },
                required: ["isDuplicate", "confidence", "reasoning"],
              },
            },
          });

          const text = response.text;
          if (!text) continue;
          const parsed = JSON.parse(text);

          if (parsed.isDuplicate && parsed.confidence >= 0.6) {
            const pk = pairKey(candidate.a.id, candidate.b.id);
            seenPairs.add(pk);
            suggestions.push({
              id: pk,
              contactA: aHydrated,
              contactB: bHydrated,
              matchType: 'ai',
              confidence: parsed.confidence,
              reasoning: parsed.reasoning,
            });
            log.info("Dedupe", `[${rid}] AI confirmed: "${candidate.a.name}" ≈ "${candidate.b.name}" (${(parsed.confidence * 100).toFixed(0)}%)`);
          } else {
            log.debug("Dedupe", `[${rid}] AI rejected: "${candidate.a.name}" ≠ "${candidate.b.name}"`);
          }
        } catch (aiErr: any) {
          log.warn("Dedupe", `[${rid}] AI evaluation failed for pair`, { error: aiErr.message });
        }
      }
    } else if (aiCandidates.length > 0) {
      log.info("Dedupe", `[${rid}] Skipping AI pass (no GEMINI_API_KEY). ${aiCandidates.length} fuzzy candidates unresolved.`);
      for (const candidate of aiCandidates) {
        if (candidate.sim >= 0.80) {
          const pk = pairKey(candidate.a.id, candidate.b.id);
          suggestions.push({
            id: pk,
            contactA: hydrateContact(candidate.a),
            contactB: hydrateContact(candidate.b),
            matchType: 'ai',
            confidence: candidate.sim * 0.7,
            reasoning: `High name similarity (${(candidate.sim * 100).toFixed(0)}%)${candidate.sameCompany ? ' and same company' : ''}. AI evaluation unavailable — set GEMINI_API_KEY for smarter matching.`,
          });
        }
      }
    }

    suggestions.sort((a: any, b: any) => b.confidence - a.confidence);
    log.info("Dedupe", `[${rid}] GET /api/dedupe/suggestions → ${suggestions.length} suggestions`);
    res.json(suggestions);
  } catch (err: any) {
    log.error("Dedupe", `[${rid}] Suggestion engine failed`, { error: err.message });
    res.status(500).json({ error: "De-duplication engine failed" });
  }
});

router.post("/contacts/merge", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { primaryId, duplicateId } = req.body;
    if (!primaryId || !duplicateId) return res.status(400).json({ error: "primaryId and duplicateId are required" });
    if (primaryId === duplicateId) return res.status(400).json({ error: "Cannot merge a contact with itself" });

    const primary = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId) as any;
    const duplicate = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(duplicateId) as any;
    if (!primary) return res.status(404).json({ error: `Primary contact ${primaryId} not found` });
    if (!duplicate) return res.status(404).json({ error: `Duplicate contact ${duplicateId} not found` });

    log.info("Merge", `[${rid}] Merging "${duplicate.name}" → "${primary.name}"`);

    const mergeTxn = sqlite.transaction(() => {
      const movedInteractions = sqlite.prepare("UPDATE interactions SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);
      log.debug("Merge", `  Moved ${movedInteractions.changes} interactions`);

      sqlite.prepare(`
        UPDATE contact_emails SET contactId = ?
        WHERE contactId = ?
        AND LOWER(TRIM(email)) NOT IN (
          SELECT LOWER(TRIM(email)) FROM contact_emails WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      const primaryPhones = sqlite.prepare("SELECT phone FROM contact_phones WHERE contactId = ?").all(primaryId) as any[];
      const primaryPhoneNorms = new Set(primaryPhones.map(p => normalizePhone(p.phone)));
      const dupePhones = sqlite.prepare("SELECT id, phone FROM contact_phones WHERE contactId = ?").all(duplicateId) as any[];
      for (const dp of dupePhones) {
        if (!primaryPhoneNorms.has(normalizePhone(dp.phone))) {
          sqlite.prepare("UPDATE contact_phones SET contactId = ? WHERE id = ?").run(primaryId, dp.id);
        }
      }

      sqlite.prepare(`
        UPDATE contact_social_links SET contactId = ?
        WHERE contactId = ?
        AND (platform || '::' || LOWER(TRIM(url))) NOT IN (
          SELECT platform || '::' || LOWER(TRIM(url)) FROM contact_social_links WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      sqlite.prepare("UPDATE contact_education SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);
      sqlite.prepare("UPDATE contact_experience SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);
      sqlite.prepare("UPDATE contact_sources SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);

      sqlite.prepare(`
        UPDATE contact_tags SET contactId = ?
        WHERE contactId = ?
        AND LOWER(TRIM(tag)) NOT IN (
          SELECT LOWER(TRIM(tag)) FROM contact_tags WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      sqlite.prepare(`
        UPDATE contact_interests SET contactId = ?
        WHERE contactId = ?
        AND LOWER(TRIM(interest)) NOT IN (
          SELECT LOWER(TRIM(interest)) FROM contact_interests WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      sqlite.prepare(`
        UPDATE contact_attributes SET contactId = ?
        WHERE contactId = ?
        AND LOWER(TRIM(name)) NOT IN (
          SELECT LOWER(TRIM(name)) FROM contact_attributes WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      sqlite.prepare(`
        UPDATE contact_addresses SET contactId = ?
        WHERE contactId = ?
        AND LOWER(TRIM(address)) NOT IN (
          SELECT LOWER(TRIM(address)) FROM contact_addresses WHERE contactId = ?
        )
      `).run(primaryId, duplicateId, primaryId);

      const scalarFields = [
        'firstName', 'lastName', 'headline', 'role', 'company', 'location',
        'birthday', 'preferences', 'avatarUrl', 'about', 'pronouns',
        'industry', 'website',
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
      log.info("Merge", `[${rid}] Merge complete. Deleted duplicate "${duplicate.name}" (${duplicateId})`);
    });

    mergeTxn();
    const merged = hydrateContact(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId));
    res.json({ success: true, contact: merged });
  } catch (err: any) {
    log.error("Merge", `[${rid}] Merge failed — transaction rolled back`, { error: err.message });
    res.status(500).json({ error: "Merge failed. No changes were made." });
  }
});

if (process.env.NODE_ENV !== 'production') {
  router.post("/dev/seed-duplicates", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const contact1Id = crypto.randomUUID();
      const contact2Id = crypto.randomUUID();
      
      const insertContact = sqlite.prepare("INSERT INTO contacts (id, name, company, role, themeColor) VALUES (?, ?, ?, ?, ?)");
      const insertEmail = sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, ?, 1)");
      
      insertContact.run(contact1Id, "Jonathan Smith", "Acme Corp", "VP Sales", "brand");
      insertEmail.run(crypto.randomUUID(), contact1Id, "jsmith@acmecorp.com");
      
      insertContact.run(contact2Id, "John Smith", "Acme Corporation", "Vice President of Sales", "indigo");
      const insertPhone = sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, isPrimary) VALUES (?, ?, ?, 1)");
      insertPhone.run(crypto.randomUUID(), contact2Id, "555-0199");
      
      log.info("Dedupe", `[${rid}] Seeded duplicate pair: Jonathan Smith / John Smith`);
      res.json({ success: true, message: "Seeded 1 duplicate pair" });
    } catch (err: any) {
      log.error("Dedupe", `[${rid}] Seed duplicates failed`, { error: err.message });
      res.status(500).json({ error: "Failed to seed duplicates" });
    }
  });
}

export const dedupeRouter = router;
