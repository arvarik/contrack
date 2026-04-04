import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import emlFormat from "eml-format";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";
import { log } from "../logger.ts";
import { extractMentions, generateCatchMeUpBriefing, summarizeEmlEmail } from "../ai/aiService.ts";
import { validateBody, interactionCreateSchema } from "../utils/validators.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.get("/contacts/:id/timeline", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const items = sqlite.prepare(`
    SELECT i.*, 
      CASE WHEN i.contactId != ? THEN original.name ELSE NULL END as isViaName,
      CASE WHEN i.contactId != ? THEN i.contactId ELSE NULL END as isViaId
    FROM interactions i
    LEFT JOIN contacts original ON i.contactId = original.id
    WHERE i.contactId = ? OR i.id IN (SELECT interactionId FROM interaction_mentions WHERE contactId = ?)
    ORDER BY i.date DESC
  `).all(req.params.id, req.params.id, req.params.id, req.params.id);
  res.json(items);
}));

router.post("/contacts/:id/interactions", validateBody(interactionCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contactId = req.params.id;
  const { type, title, content, date, duration, source } = req.body;

  const id = crypto.randomUUID();
  const now = date || new Date().toISOString();

  const result = db.insert(schema.interactions).values({
    id, contactId, type, title,
    content: content || null, date: now,
    duration: duration || null, source: source || null,
  }).returning().get();

  if (content) {
    const mentionRegex = /data-type="mention"\s+data-id="([^"]+)"/g;
    const explicitMentionIds = [...content.matchAll(mentionRegex)].map(m => m[1]);
    if (explicitMentionIds.length > 0) {
      const insertStmt = sqlite.prepare("INSERT OR IGNORE INTO interaction_mentions (interactionId, contactId) VALUES (?, ?)");
      for (const mId of explicitMentionIds) {
        insertStmt.run(id, mId);
      }
    }
  }

  db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: new Date().toISOString(), aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();

  // Safely wrapped async background extraction
  if (content) {
    setTimeout(() => {
      (async () => {
        try {
          const mentions = await extractMentions(content);
          if (mentions && mentions.length > 0) {
            const mappedMentions = [];
            for (const m of mentions) {
              let existing = db.select().from(schema.contacts).where(eq(schema.contacts.name, m.name)).get();
              if (!existing) {
                const ghostId = crypto.randomUUID();
                const newTheme = ["brand", "indigo", "rose", "emerald", "amber"][Math.floor(Math.random() * 5)];
                existing = db.insert(schema.contacts).values({
                  id: ghostId,
                  name: m.name,
                  company: m.company || null,
                  isGhost: 1,
                  themeColor: newTheme,
                }).returning().get();
                log.info("AI Service", `Inferred ghost contact: ${m.name}`);
              }
              mappedMentions.push({
                contactId: existing.id,
                name: existing.name,
                context: m.context,
                isGhost: existing.isGhost === 1
              });
            }
            db.update(schema.interactions).set({ mentions: JSON.stringify(mappedMentions) }).where(eq(schema.interactions.id, id)).run();
          }
        } catch(e: any) {
          log.error("AI Service", "Background extraction failed", {error: e.message});
        }
      })().catch(err => log.error("AI Service", "Unhandled ghost extraction crash", {error: err.message}));
    }, 0);
  }

  log.info("API", `[${rid}] POST interaction → ${type} "${title}"`);
  res.status(201).json(result);
}));

router.post("/contacts/:id/briefing", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contactId = req.params.id;
  const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
  if (!contact) throw new AppError("Contact not found", 404);

  const recentInteractions = db.select()
    .from(schema.interactions)
    .where(eq(schema.interactions.contactId, contactId))
    .orderBy(sql`${schema.interactions.date} DESC`)
    .limit(15)
    .all();

  const points = await generateCatchMeUpBriefing(contact, recentInteractions);
  const now = new Date().toISOString();

  db.update(schema.contacts).set({
    aiBriefing: JSON.stringify(points),
    aiBriefingAt: now,
    updatedAt: now
  }).where(eq(schema.contacts.id, contactId)).run();

  log.info("API", `[${rid}] POST briefing generated for ${contactId}`);
  res.json({ points });
}));

router.post("/contacts/:id/promote", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contactId = req.params.id;
  const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
  if (!contact) throw new AppError("Contact not found", 404);

  const updated = db.update(schema.contacts).set({ isGhost: 0, updatedAt: new Date().toISOString() }).where(eq(schema.contacts.id, contactId)).returning().get();
  log.info("API", `[${rid}] Promoted ghost contact: ${contact.name}`);
  res.json(updated);
}));

router.post("/contacts/:id/attachments", upload.single("attachment"), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  if (!req.file) throw new AppError("No file", 400);
  const contactId = req.params.id;
  const now = new Date().toISOString();

  if (req.file.originalname.toLowerCase().endsWith('.eml')) {
    const rawEml = fs.readFileSync(req.file.path, 'utf8');
    
    const emlData = await new Promise<any>((resolve, reject) => {
      emlFormat.read(rawEml, (err: any, data: any) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const extractedThread = emlData?.text || emlData?.html || rawEml;
    const summaryHtml = await summarizeEmlEmail(extractedThread as string);
    
    const result = db.insert(schema.interactions).values({
      id: crypto.randomUUID(), contactId, type: "email",
      title: `Email Import: ${req.file.originalname.replace('.eml', '')}`, date: now,
      content: summaryHtml,
      fileUrl: `/uploads/${req.file.filename}`,
      fileName: req.file.originalname, fileType: "message/rfc822",
    }).returning().get();

    db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: now, aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();
    log.info("API", `[${rid}] POST EML thread processed → "${req.file.originalname}"`);
    return res.status(201).json(result);
  }

  const result = db.insert(schema.interactions).values({
    id: crypto.randomUUID(), contactId, type: "note",
    title: `Attached File: ${req.file.originalname}`, date: now,
    fileUrl: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname, fileType: req.file.mimetype,
  }).returning().get();

  db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: now, aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();

  log.info("API", `[${rid}] POST attachment → "${req.file.originalname}"`);
  res.status(201).json(result);
}));

router.patch("/interactions/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const existing = db.select().from(schema.interactions).where(eq(schema.interactions.id, req.params.id)).get();
  if (!existing) throw new AppError("Not found", 404);

  const { title, content } = req.body;
  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;

  if (Object.keys(updates).length === 0) {
    throw new AppError("No valid fields to update", 400);
  }

  // Always stamp updatedAt on edit
  updates.updatedAt = new Date().toISOString();

  const result = db.update(schema.interactions)
    .set(updates)
    .where(eq(schema.interactions.id, req.params.id))
    .returning()
    .get();

  log.info("API", `[${rid}] PATCH interaction → ${req.params.id}`);
  res.json(result);
}));

router.delete("/interactions/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const existing = db.select().from(schema.interactions).where(eq(schema.interactions.id, req.params.id)).get();
  if (!existing) throw new AppError("Not found", 404);

  if (existing.fileUrl?.startsWith("/uploads/")) {
    const filePath = path.join(process.cwd(), existing.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await db.delete(schema.interactions).where(eq(schema.interactions.id, req.params.id)).run();
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Relationships — Traverse the interaction_mentions graph
// ---------------------------------------------------------------------------
// Returns contacts connected to the given contact through shared interactions,
// with a sharedInteractions strength metric. Foundation for network graph view.
// ---------------------------------------------------------------------------

router.get("/contacts/:id/relationships", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contactId = req.params.id;
  const limit = parseInt(req.query.limit as string) || 50;

  // Find all contacts that appear in the same interaction graph
  // (either as the interaction author or as a mention)
  const rows = sqlite.prepare(`
    SELECT DISTINCT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.role, c.isGhost,
           COUNT(DISTINCT shared.interactionId) as sharedInteractions
    FROM (
      -- Interactions authored by this contact that mention others
      SELECT im.interactionId, im.contactId as relatedContactId
      FROM interactions i
      JOIN interaction_mentions im ON i.id = im.interactionId
      WHERE i.contactId = ?

      UNION

      -- Interactions mentioning this contact, authored by others
      SELECT im2.interactionId, i2.contactId as relatedContactId
      FROM interaction_mentions im2
      JOIN interactions i2 ON im2.interactionId = i2.id
      WHERE im2.contactId = ?

      UNION

      -- Co-mentions: other contacts mentioned in the same interactions
      SELECT im3.interactionId, im3.contactId as relatedContactId
      FROM interaction_mentions im3
      WHERE im3.interactionId IN (
        SELECT interactionId FROM interaction_mentions WHERE contactId = ?
      )
    ) shared
    JOIN contacts c ON shared.relatedContactId = c.id
    WHERE c.id != ?
    GROUP BY c.id
    ORDER BY sharedInteractions DESC
    LIMIT ?
  `).all(contactId, contactId, contactId, contactId, limit);

  log.debug("API", `[${rid}] GET /api/contacts/${contactId}/relationships → ${rows.length}`);
  res.json(rows);
}));

export const interactionsRouter = router;
