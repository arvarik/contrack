import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { log } from "../utils/logger.ts";
import { contactService } from "../services/contactService.ts";
import { parseContactRecord } from "../ai/aiService.ts";
import { validateBody, contactCreateSchema, contactUpdateSchema, contactBulkCreateSchema } from "../utils/validators.ts";
import { z } from 'zod';
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { sqlite } from "../db.ts";
import { generateAndStoreBulkEmbeddings, isEmbeddingAvailable } from "../services/dedupe/embeddings.ts";
import { dedupeService } from "../services/dedupe/index.ts";
import { normalizeContactById, normalizeContacts } from "../services/dedupe/normalization.ts";
import { normalizePhone, isNicknameMatch } from "../utils/nlp/index.ts";
import { loadNegativeConstraints, pairKey } from "../services/dedupe/blocking.ts";
import { storeSuggestion } from "../services/dedupe/suggestions.ts";
import { computePrimaryScore } from "../services/dedupe/clustering.ts";
import { contactRepo } from "../repositories/contactRepository.ts";

const avatarDir = path.join(process.cwd(), "uploads", "avatars");
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap for avatars
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});



const router = Router();

router.get("/contacts/map", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const results = contactService.getMapContacts();
  log.debug("API", `[${rid}] GET /api/contacts/map → ${results.length}`);
  res.json(results);
}));

router.get("/contacts/archived", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const results = contactService.getArchivedContacts();
  log.debug("API", `[${rid}] GET /api/contacts/archived → ${results.length}`);
  res.json(results);
}));

router.get("/contacts", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const view = req.query.view as string;

  if (view === 'slim') {
    const results = contactService.getSlimContacts();
    log.debug("API", `[${rid}] GET /api/contacts?view=slim → ${results.length} (slim)`);
    return res.json(results);
  }

  const results = contactService.getAllContacts();
  log.debug("API", `[${rid}] GET /api/contacts → ${results.length}`);
  res.json(results);
}));

router.get("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contact = contactService.getContactById(req.params.id);
  if (!contact) {
    log.warn("API", `[${rid}] 404 ${req.params.id}`); 
    throw new AppError("Not found", 404);
  }
  res.json(contact);
}));

router.post("/contacts", validateBody(contactCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  if (!req.body.name) throw new AppError("Name is required", 400);

  const contact = contactService.createContact(req.body);
  log.info("API", `[${rid}] POST /api/contacts → "${req.body.name}" (${contact?.id})`);
  res.status(201).json(contact);
}));

router.post("/contacts/bulk", validateBody(contactBulkCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const wantsStream = req.headers.accept?.includes("text/event-stream");

  if (wantsStream) {
    // =====================================================================
    // SSE Multi-Phase Import Pipeline
    // Phase 1: Import contacts
    // Phase 2: Generate embeddings (if available)
    // Phase 3: Run dedupe scan against imported contacts
    // Phase 4: Stream results summary
    // =====================================================================
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (data: Record<string, any>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Phase 1: Import
    const { count, createdIds } = await contactService.bulkCreateContacts(req.body, (processed, total, phase) => {
      send({ phase: 'importing', processed, total, message: phase });
    });

    log.info("API", `[${rid}] POST /api/contacts/bulk → ${count} imported`);

    // Phase 2: Generate embeddings for imported contacts
    if (createdIds.length > 0 && isEmbeddingAvailable()) {
      send({ phase: 'embedding', message: 'Generating contact fingerprints…' });
      try {
        await generateAndStoreBulkEmbeddings(createdIds);
        log.info("API", `[${rid}] Bulk embeddings generated for ${createdIds.length} contacts`);
      } catch (err: any) {
        log.warn("API", `[${rid}] Bulk embedding failed: ${err.message}`);
      }
    }

    // Phase 3: Dedupe scan against imported contacts
    let autoMerged = 0;
    let needsReview = 0;
    // Track which imported contacts were involved in any match
    const matchedImportIds = new Set<string>();

    if (createdIds.length >= 1) {
      send({ phase: 'scanning', message: 'Looking for duplicates…' });

      try {
        const importedSet = new Set(createdIds);
        const distinctPairs = loadNegativeConstraints();
        const allNormalized = normalizeContacts();
        const seenPairs = new Set<string>();

        // For each imported contact, check for duplicates against ALL contacts
        for (let i = 0; i < createdIds.length; i++) {
          const contactId = createdIds[i];
          const target = normalizeContactById(contactId);
          if (!target) continue;

          // Check exact name matches
          if (target.nameNorm) {
            for (const other of allNormalized) {
              if (other.id === contactId) continue;
              // Skip other imported contacts in this same batch
              if (importedSet.has(other.id)) continue;
              const pk = pairKey(contactId, other.id);
              if (seenPairs.has(pk) || distinctPairs.has(pk)) continue;

              if (target.nameNorm === other.nameNorm) {
                seenPairs.add(pk);
                matchedImportIds.add(contactId);

                // During import, an exact name match against an existing contact
                // is almost certainly a duplicate — use higher confidence (0.95)
                // than the general scan's 0.92 for same-source matches.
                const pair = {
                  idA: contactId, idB: other.id,
                  matchType: 'name' as any,
                  confidence: 0.95,
                  reasoning: 'Exact name match (import-time detection)',
                };

                try {
                  const rawA = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(pair.idA));
                  const rawB = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(pair.idB));
                  const scoreA = computePrimaryScore(rawA);
                  const scoreB = computePrimaryScore(rawB);
                  const [primaryId, duplicateId] = scoreA >= scoreB
                    ? [pair.idA, pair.idB] : [pair.idB, pair.idA];

                  dedupeService.softMergeContacts(primaryId, duplicateId, pair.confidence, pair.reasoning, rid);
                  storeSuggestion(pair, 'auto_merged');
                  autoMerged++;
                } catch (err: any) {
                  storeSuggestion(pair, 'pending');
                  needsReview++;
                }
                continue;
              }

              // Nickname match
              if (target.lastNameNorm && target.lastNameNorm === other.lastNameNorm && target.firstNameNorm && other.firstNameNorm) {
                if (isNicknameMatch(target.firstNameNorm, other.firstNameNorm)) {
                  seenPairs.add(pk);
                  matchedImportIds.add(contactId);
                  const pair = {
                    idA: contactId, idB: other.id,
                    matchType: 'nickname' as any,
                    confidence: 0.88,
                    reasoning: `Nickname match ("${target.firstNameNorm}" ↔ "${other.firstNameNorm}")`,
                  };
                  storeSuggestion(pair, 'pending');
                  needsReview++;
                }
              }
            }
          }

          // Check email overlap
          if (target.emailsNorm.length > 0) {
            const placeholders = target.emailsNorm.map(() => "?").join(",");
            const emailMatches = sqlite.prepare(`
              SELECT DISTINCT ce.contactId
              FROM contact_emails ce
              JOIN contacts c ON c.id = ce.contactId
              WHERE LOWER(TRIM(ce.email)) IN (${placeholders})
                AND ce.contactId != ?
                AND c.isGhost = 0 AND (c.isArchived = 0 OR c.isArchived IS NULL) AND c.canonicalId IS NULL
            `).all(...target.emailsNorm, contactId) as { contactId: string }[];

            for (const match of emailMatches) {
              if (importedSet.has(match.contactId)) continue;
              const pk = pairKey(contactId, match.contactId);
              if (seenPairs.has(pk) || distinctPairs.has(pk)) continue;
              seenPairs.add(pk);
              matchedImportIds.add(contactId);

              const pair = {
                idA: contactId, idB: match.contactId,
                matchType: 'email' as any, confidence: 0.99,
                reasoning: 'Shared email address',
              };

              try {
                const rawA = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(pair.idA));
                const rawB = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(pair.idB));
                const scoreA = computePrimaryScore(rawA);
                const scoreB = computePrimaryScore(rawB);
                const [primaryId, duplicateId] = scoreA >= scoreB
                  ? [pair.idA, pair.idB] : [pair.idB, pair.idA];

                dedupeService.softMergeContacts(primaryId, duplicateId, pair.confidence, pair.reasoning, rid);
                storeSuggestion(pair, 'auto_merged');
                autoMerged++;
              } catch {
                storeSuggestion(pair, 'pending');
                needsReview++;
              }
            }
          }

          // Check phone overlap
          if (target.phonesNorm.length > 0) {
            const allPhones = sqlite.prepare(`
              SELECT contactId, phone FROM contact_phones cp
              JOIN contacts c ON c.id = cp.contactId
              WHERE cp.contactId != ? AND c.isGhost = 0 AND (c.isArchived = 0 OR c.isArchived IS NULL) AND c.canonicalId IS NULL
            `).all(contactId) as { contactId: string; phone: string }[];

            const targetPhoneSet = new Set(target.phonesNorm);
            for (const row of allPhones) {
              if (importedSet.has(row.contactId)) continue;
              const norm = normalizePhone(row.phone);
              if (norm && targetPhoneSet.has(norm)) {
                const pk = pairKey(contactId, row.contactId);
                if (seenPairs.has(pk) || distinctPairs.has(pk)) continue;
                seenPairs.add(pk);
                matchedImportIds.add(contactId);

                const pair = {
                  idA: contactId, idB: row.contactId,
                  matchType: 'phone' as any, confidence: 0.95,
                  reasoning: 'Shared phone number',
                };

                try {
                  const rawA = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(pair.idA));
                  const rawB = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(pair.idB));
                  const scoreA = computePrimaryScore(rawA);
                  const scoreB = computePrimaryScore(rawB);
                  const [primaryId, duplicateId] = scoreA >= scoreB
                    ? [pair.idA, pair.idB] : [pair.idB, pair.idA];

                  dedupeService.softMergeContacts(primaryId, duplicateId, pair.confidence, pair.reasoning, rid);
                  storeSuggestion(pair, 'auto_merged');
                  autoMerged++;
                } catch {
                  storeSuggestion(pair, 'pending');
                  needsReview++;
                }
              }
            }
          }

          // Stream progress periodically
          if (i > 0 && i % 50 === 0) {
            send({ phase: 'scanning', message: `Checked ${i}/${createdIds.length} contacts…`, autoMerged, needsReview });
          }
        }

        log.info("API", `[${rid}] Post-import dedupe: ${autoMerged} auto-merged, ${needsReview} pending, ${matchedImportIds.size}/${createdIds.length} contacts had matches`);
      } catch (err: any) {
        log.warn("API", `[${rid}] Post-import dedupe failed: ${err.message}`);
      }
    }

    // Phase 4: Complete — send summary
    // newUnique = imported contacts that had NO matches at all
    const newUnique = count - matchedImportIds.size;
    send({
      done: true,
      count,
      summary: {
        imported: count,
        autoMerged,
        needsReview,
        newUnique: Math.max(0, newUnique),
      },
    });
    res.end();
  } else {
    // Standard JSON mode — for small imports or non-streaming clients
    const { count, createdIds } = await contactService.bulkCreateContacts(req.body);
    log.info("API", `[${rid}] POST /api/contacts/bulk → ${count} imported`);

    // Generate embeddings + schedule incremental dedupe for each contact
    if (createdIds.length > 0) {
      generateAndStoreBulkEmbeddings(createdIds).catch(err =>
        log.warn("API", `Background bulk embedding failed: ${err.message}`)
      );
      // Schedule incremental dedupe for each imported contact
      for (const cid of createdIds) {
        setTimeout(() => {
          const irid = `imp-${cid.slice(0, 8)}`;
          dedupeService.incrementalDedupeCheck(cid, irid).catch(err =>
            log.warn("API", `Incremental dedupe for ${cid} failed: ${err.message}`)
          );
        }, 3_000);
      }
    }
    res.status(201).json({ success: true, count });
  }
}));

router.post("/parse-contact", validateBody(z.object({ text: z.string().min(1, "text is required") })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { text } = req.body;
  const parsed = await parseContactRecord(text);
  log.info("API", `[${rid}] POST /api/parse-contact → parsed "${parsed.name}"`);
  res.json(parsed);
}));

router.post("/contacts/bulk-delete", validateBody(z.object({ ids: z.array(z.string().min(1)).min(1) })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const count = contactService.bulkDeleteContacts(req.body.ids);
  log.info("API", `[${rid}] POST /api/contacts/bulk-delete → ${count} deleted`);
  res.json({ success: true, count });
}));

router.put("/contacts/bulk-update", validateBody(z.object({ ids: z.array(z.string().min(1)).min(1), data: contactUpdateSchema })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const count = contactService.bulkUpdateContacts(req.body.ids, req.body.data);
  log.info("API", `[${rid}] PUT /api/contacts/bulk-update → ${count} updated`);
  res.json({ success: true, count });
}));

router.put("/contacts/:id", validateBody(contactUpdateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const updated = contactService.updateContact(req.params.id, req.body);
  if (!updated) throw new AppError("Not found", 404);
  log.info("API", `[${rid}] PUT /api/contacts/${req.params.id} → updated`);
  res.json(updated);
}));

router.patch("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const childKeys = ['emails', 'phones', 'socialLinks', 'tags', 'interests', 'addresses', 'attributes', 'education', 'experience', 'sources'];
  const hasChildArrays = childKeys.some(k => req.body[k] !== undefined);
  if (hasChildArrays) {
    throw new AppError("PATCH does not support child arrays. Use PUT for full updates.", 400);
  }

  const updated = contactService.patchContact(req.params.id, req.body);
  if (!updated) throw new AppError("Not found", 404);
  log.info("API", `[${rid}] PATCH /api/contacts/${req.params.id} → updated (scalar)`);
  res.json(updated);
}));

router.delete("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const success = contactService.deleteContact(req.params.id);
  if (!success) throw new AppError("Not found", 404);
  log.info("API", `[${rid}] DELETE /api/contacts/${req.params.id}`);
  res.json({ success: true });
}));

router.post("/contacts/:id/avatar", uploadAvatar.single("avatar"), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  if (!req.file) throw new AppError("No image file provided", 400);
  
  const updated = contactService.updateAvatar(req.params.id, req.file.filename, req.file.originalname);
  if (!updated) throw new AppError("Contact not found", 404);
  
  log.info("API", `[${rid}] POST /api/contacts/${req.params.id}/avatar → uploaded`);
  res.json(updated);
}));

export const contactsRouter = router;
