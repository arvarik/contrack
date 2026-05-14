import { sqlite, db } from "../../db.ts";
import * as schema from "../../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import { normalizePhone } from "../../utils/nlp/index.ts";
import { recordMergeUnsafe } from "./suggestions.ts";
import { NotFoundError } from "../../utils/AppError.ts";

export function mergeContacts(primaryId: string, duplicateId: string, rid: string) {
  // Note: the TOCTOU window between these SELECTs and the BEGIN inside the
  // transaction is bounded by SQLite's serialized writer. The transaction
  // itself re-reads both rows before mutating (see comment inside the txn).
  const primary = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId) as any;
  const duplicate = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(duplicateId) as any;

  if (!primary) {
    throw new NotFoundError("Primary contact", primaryId);
  }

  if (!duplicate) {
    log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} already deleted, skipping merge into ${primaryId}`);
    return contactRepo.hydrate(primary);
  }

  const mergeTxn = sqlite.transaction(() => {
    // Re-read inside the transaction so we observe a consistent snapshot.
    // SQLite's WAL mode + foreign-keys=ON guarantees the writer is serialized,
    // but we still need the in-tx read to catch the case where the primary
    // was deleted between the outer SELECT and the BEGIN.
    const primaryInTx = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(primaryId);
    if (!primaryInTx) {
      throw new NotFoundError("Primary contact", primaryId);
    }
    const duplicateInTx = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(duplicateId);
    if (!duplicateInTx) {
      log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} vanished mid-merge — aborting txn`);
      return;
    }

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

    // vec0 tables don't support FK cascading — clean up before hard delete
    try { sqlite.prepare("DELETE FROM search_embeddings WHERE contactId = ?").run(duplicateId); } catch { /* vec0 row may not exist */ }
    try { sqlite.prepare("DELETE FROM contact_embeddings WHERE contactId = ?").run(duplicateId); } catch { /* vec0 row may not exist */ }

    sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(duplicateId);

    // Audit log is part of the SAME transaction. If recordMerge throws (e.g.
    // an unexpected FK problem in dedupe_merge_log), the entire merge rolls
    // back. Previously this ran AFTER mergeTxn() committed, which meant a
    // crash between commit and recordMerge would orphan the merge without
    // an audit row — making `undoSoftMerge` impossible.
    recordMergeUnsafe(primaryId, duplicateId, 1.0, "User-initiated merge", "user", "hard");
  });

  mergeTxn();
  return contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId));
}

export function softMergeContacts(primaryId: string, duplicateId: string, confidence: number, reasoning: string, rid: string) {
  const primary = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId) as any;
  const duplicate = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(duplicateId) as any;

  if (!primary) {
    throw new NotFoundError("Primary contact", primaryId);
  }
  if (!duplicate) {
    log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} not found — skipping soft merge`);
    return;
  }
  if (duplicate.canonicalId) {
    log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} already soft-merged — skipping`);
    return;
  }

  const softTxn = sqlite.transaction(() => {
    // Re-validate inside the transaction. If a concurrent soft-merge set
    // canonicalId between the outer SELECT and BEGIN, bail out atomically.
    const dupInTx = sqlite.prepare("SELECT id, canonicalId FROM contacts WHERE id = ?").get(duplicateId) as { id: string; canonicalId: string | null } | undefined;
    if (!dupInTx) {
      log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} vanished mid soft-merge — aborting txn`);
      return;
    }
    if (dupInTx.canonicalId) {
      log.warn("DedupeService", `[${rid}] Duplicate ${duplicateId} was soft-merged concurrently — aborting txn`);
      return;
    }

    // 1:1 same as mergeContacts, minus the hard DELETE
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

    sqlite.prepare("UPDATE contacts SET canonicalId = ? WHERE id = ?").run(primaryId, duplicateId);

    // Audit log is part of the SAME transaction — see comment in mergeContacts().
    recordMergeUnsafe(primaryId, duplicateId, confidence, reasoning, "auto", "soft");
  });

  softTxn();
  log.info("DedupeService", `[${rid}] Soft-merged ${duplicateId} → ${primaryId} (confidence: ${(confidence * 100).toFixed(0)}%)`);
}
