import crypto from "crypto";
import fs from "fs";
import path from "path";
import emlFormat from "eml-format";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";
import { log } from "../utils/logger.ts";
import { extractMentions, generateCatchMeUpBriefing, summarizeEmlEmail } from "../ai/aiService.ts";

export const interactionService = {
  getTimeline(contactId: string) {
    return sqlite.prepare(`
      SELECT i.*, 
        CASE WHEN i.contactId != ? THEN original.name ELSE NULL END as isViaName,
        CASE WHEN i.contactId != ? THEN i.contactId ELSE NULL END as isViaId
      FROM interactions i
      LEFT JOIN contacts original ON i.contactId = original.id
      WHERE i.contactId = ? OR i.id IN (SELECT interactionId FROM interaction_mentions WHERE contactId = ?)
      ORDER BY i.date DESC
    `).all(contactId, contactId, contactId, contactId);
  },

  createInteraction(contactId: string, body: any) {
    const { type, title, content, date, duration, source } = body;
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

    return result;
  },

  async generateBriefing(contactId: string) {
    const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
    if (!contact) return null;

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

    return points;
  },

  promoteGhost(contactId: string) {
    const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
    if (!contact) return null;

    return db.update(schema.contacts)
      .set({ isGhost: 0, updatedAt: new Date().toISOString() })
      .where(eq(schema.contacts.id, contactId))
      .returning()
      .get();
  },

  async handleAttachment(contactId: string, file: Express.Multer.File) {
    const now = new Date().toISOString();

    if (file.originalname.toLowerCase().endsWith('.eml')) {
      const rawEml = fs.readFileSync(file.path, 'utf8');
      
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
        title: `Email Import: ${file.originalname.replace('.eml', '')}`, date: now,
        content: summaryHtml,
        fileUrl: `/uploads/${file.filename}`,
        fileName: file.originalname, fileType: "message/rfc822",
      }).returning().get();

      db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: now, aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();
      return result;
    }

    const result = db.insert(schema.interactions).values({
      id: crypto.randomUUID(), contactId, type: "note",
      title: `Attached File: ${file.originalname}`, date: now,
      fileUrl: `/uploads/${file.filename}`,
      fileName: file.originalname, fileType: file.mimetype,
    }).returning().get();

    db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: now, aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();
    return result;
  },

  updateInteraction(id: string, body: any) {
    const existing = db.select().from(schema.interactions).where(eq(schema.interactions.id, id)).get();
    if (!existing) return null;

    const { title, content } = body;
    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;

    if (Object.keys(updates).length === 0) return existing;

    updates.updatedAt = new Date().toISOString();

    return db.update(schema.interactions)
      .set(updates)
      .where(eq(schema.interactions.id, id))
      .returning()
      .get();
  },

  deleteInteraction(id: string) {
    const existing = db.select().from(schema.interactions).where(eq(schema.interactions.id, id)).get();
    if (!existing) return false;

    if (existing.fileUrl?.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), existing.fileUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    db.delete(schema.interactions).where(eq(schema.interactions.id, id)).run();
    return true;
  },

  getRelationships(contactId: string, limit: number) {
    return sqlite.prepare(`
      SELECT DISTINCT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.role, c.isGhost,
             COUNT(DISTINCT shared.interactionId) as sharedInteractions
      FROM (
        SELECT im.interactionId, im.contactId as relatedContactId
        FROM interactions i
        JOIN interaction_mentions im ON i.id = im.interactionId
        WHERE i.contactId = ?
  
        UNION
  
        SELECT im2.interactionId, i2.contactId as relatedContactId
        FROM interaction_mentions im2
        JOIN interactions i2 ON im2.interactionId = i2.id
        WHERE im2.contactId = ?
  
        UNION
  
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
  }
};
