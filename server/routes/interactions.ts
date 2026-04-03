import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";
import { log } from "../logger.ts";
import { extractMentions, generateCatchMeUpBriefing, summarizeEmlEmail } from "../../aiService.ts";

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

router.get("/contacts/:id/timeline", async (req, res) => {
  const rid = (req as any).requestId;
  try {
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
  } catch (err: any) {
    log.error("API", `[${rid}] GET timeline failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch timeline" });
  }
});

router.post("/contacts/:id/interactions", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const contactId = req.params.id;
    const { type, title, content, date, duration, source } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const validTypes = ["note", "call", "meeting", "email", "message", "sms", "import", "linkedin", "facebook"];
    if (!type || !validTypes.includes(type)) return res.status(400).json({ error: `Valid type required: ${validTypes.join(', ')}` });

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
  } catch (err: any) {
    log.error("API", `[${rid}] POST interaction failed`, { error: err.message });
    res.status(500).json({ error: "Failed to create interaction" });
  }
});

router.post("/contacts/:id/briefing", async (req, res) => {
  const rid = (req as any).requestId;
  try {
    const contactId = req.params.id;
    const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
    if (!contact) return res.status(404).json({ error: "Contact not found" });

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
  } catch (err: any) {
    log.error("API", `[${rid}] POST briefing failed`, { error: err.message });
    res.status(500).json({ error: "Failed to generate briefing" });
  }
});

router.post("/contacts/:id/promote", async (req, res) => {
  const rid = (req as any).requestId;
  try {
    const contactId = req.params.id;
    const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const updated = db.update(schema.contacts).set({ isGhost: 0, updatedAt: new Date().toISOString() }).where(eq(schema.contacts.id, contactId)).returning().get();
    log.info("API", `[${rid}] Promoted ghost contact: ${contact.name}`);
    res.json(updated);
  } catch (err: any) {
    log.error("API", `[${rid}] POST promote failed`, { error: err.message });
    res.status(500).json({ error: "Failed to promote contact" });
  }
});

router.post("/contacts/:id/attachments", upload.single("attachment"), async (req, res) => {
  const rid = (req as any).requestId;
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const contactId = req.params.id;
    const now = new Date().toISOString();

    if (req.file.originalname.toLowerCase().endsWith('.eml')) {
      const rawEml = fs.readFileSync(req.file.path, 'utf8');
      const summaryHtml = await summarizeEmlEmail(rawEml);
      
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
  } catch (err: any) {
    log.error("API", `[${rid}] POST attachment failed`, { error: err.message });
    res.status(500).json({ error: "Failed to upload attachment" });
  }
});

router.delete("/interactions/:id", async (req, res) => {
  const rid = (req as any).requestId;
  try {
    const existing = db.select().from(schema.interactions).where(eq(schema.interactions.id, req.params.id)).get();
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (existing.fileUrl?.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), existing.fileUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await db.delete(schema.interactions).where(eq(schema.interactions.id, req.params.id)).run();
    res.json({ success: true });
  } catch (err: any) {
    log.error("API", `[${rid}] DELETE interaction failed`, { error: err.message });
    res.status(500).json({ error: "Failed to delete interaction" });
  }
});

export const interactionsRouter = router;
