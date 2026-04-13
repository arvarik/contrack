import crypto from "crypto";
import fs from "fs";
import path from "path";
import emlFormat from "eml-format";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";
import { log } from "../utils/logger.ts";
import { extractMentions, generateCatchMeUpBriefing, summarizeEmlEmail } from "../ai/aiService.ts";
import { relationshipService } from "./relationshipService.ts";
import { aiCache } from "../utils/aiCache.ts";

// =============================================================================
// Interaction Payload Types
// =============================================================================

/** Payload for creating a new interaction. */
interface CreateInteractionPayload {
  type: string;
  title: string;
  content?: string | null;
  date?: string;
  duration?: string | null;
  source?: string | null;
  actionItem?: { title: string; dueAt: string };
}

/** Payload for updating an existing interaction. Only title and content are mutable. */
interface UpdateInteractionPayload {
  title?: string;
  content?: string;
}
import { getErrorMessage } from "../utils/helpers.ts";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Background ghost-contact extraction from an interaction note.
 * Runs asynchronously via setTimeout(0) so it never blocks the HTTP response.
 * Errors are caught and logged — they must never surface to the caller.
 */
async function runMentionExtraction(interactionId: string, contactId: string, content: string): Promise<void> {
  try {
    const mentions = await extractMentions(content);
    if (!mentions || mentions.length === 0) return;

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
    db.update(schema.interactions)
      .set({ mentions: JSON.stringify(mappedMentions) })
      .where(eq(schema.interactions.id, interactionId))
      .run();
  } catch (e: unknown) {
    log.error("AI Service", `Background mention extraction failed for interaction ${interactionId}`, { error: getErrorMessage(e) });
  }
}

export const interactionService = {
  getTimeline(contactId: string) {
    const raw = sqlite.prepare(`
      SELECT i.*, 
        CASE WHEN i.contactId != ? THEN original.name ELSE NULL END as isViaName,
        CASE WHEN i.contactId != ? THEN i.contactId ELSE NULL END as isViaId,
        (
          SELECT json_group_array(json_object('id', a.id, 'title', a.title, 'dueAt', a.dueAt, 'completedAt', a.completedAt)) 
          FROM action_items a WHERE a.interactionId = i.id
        ) as actionItemsRaw
      FROM interactions i
      LEFT JOIN contacts original ON i.contactId = original.id
      WHERE i.contactId = ? OR i.id IN (SELECT interactionId FROM interaction_mentions WHERE contactId = ?)
      ORDER BY i.date DESC
    `).all(contactId, contactId, contactId, contactId) as Array<Record<string, unknown>>;

    return raw.map(row => {
      let actionItems = [];
      if (row.actionItemsRaw) {
        try {
          const parsed = JSON.parse(row.actionItemsRaw as string);
          // sqlite json_group_array returns '[{}]' even if null sometimes or '[null]'
          actionItems = parsed.filter((p: Record<string, unknown>) => p && p.id);
        } catch { }
      }
      delete row.actionItemsRaw;
      return { ...row, actionItems };
    });
  },

  createInteraction(contactId: string, body: CreateInteractionPayload) {
    const { type, title, content, date, duration, source } = body;
    const id = crypto.randomUUID();
    const now = date || new Date().toISOString();

    const result = sqlite.transaction(() => {
      const res = db.insert(schema.interactions).values({
        id, contactId, type, title,
        content: content || null, date: now,
        duration: duration || null, source: source || null,
      }).returning().get();

      if (content) {
        const mentionRegex = /data-type="mention"\\s+data-id="([^"]+)"/g;
        const explicitMentionIds = [...content.matchAll(mentionRegex)].map(m => m[1]);
        if (explicitMentionIds.length > 0) {
          const insertStmt = sqlite.prepare("INSERT OR IGNORE INTO interaction_mentions (interactionId, contactId) VALUES (?, ?)");
          for (const mId of explicitMentionIds) {
            insertStmt.run(id, mId);
          }
        }
      }

      db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: new Date().toISOString(), aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();

      // Atomically create an action item if provided alongside the interaction
      if (body.actionItem && body.actionItem.title && body.actionItem.dueAt) {
        sqlite.prepare(`
          INSERT INTO action_items (id, contactId, interactionId, title, dueAt)
          VALUES (?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), contactId, id, body.actionItem.title, body.actionItem.dueAt);
        log.info("Interactions", `Created action item "${body.actionItem.title}" alongside interaction`);
      }
      
      return res;
    })();
    // Schedule background ghost-contact extraction — never blocks the response
    if (content) {
      setTimeout(() => { runMentionExtraction(id, contactId, content); }, 0);
    }

    // Invalidate cached briefing for this contact — a new interaction means
    // any cached briefing is stale (it doesn't include this interaction)
    aiCache.invalidate("briefing", contactId);

    // Immediately recompute relationship score for this contact
    relationshipService.computeScore(contactId);

    return result;
  },

  async generateBriefing(contactId: string) {
    const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
    if (!contact) return null;

    // ── Briefing cache: key = contactId::interactionCount
    // If the interaction count hasn't changed since the last briefing, the
    // cached result is still valid. Any new interaction increments the count,
    // producing a different cache key → automatic invalidation.
    const interactionCount = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM interactions WHERE contactId = ?"
    ).get(contactId) as { c: number }).c;
    const cacheKey = `${contactId}::${interactionCount}`;

    const cached = aiCache.get<string[]>("briefing", cacheKey);
    if (cached) {
      log.info("Briefing", `Cache HIT for ${contact.name} (${interactionCount} interactions)`);
      return cached;
    }

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

    // Cache the freshly generated briefing
    aiCache.set("briefing", cacheKey, points);
    log.info("Briefing", `Cached for ${contact.name} (key: ${cacheKey})`);

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
      
      const emlData = await new Promise<Record<string, unknown>>((resolve, reject) => {
        emlFormat.read(rawEml, (err: Error | null, data: Record<string, unknown>) => {
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
      relationshipService.computeScore(contactId);
      return result;
    }

    const result = db.insert(schema.interactions).values({
      id: crypto.randomUUID(), contactId, type: "note",
      title: `Attached File: ${file.originalname}`, date: now,
      fileUrl: `/uploads/${file.filename}`,
      fileName: file.originalname, fileType: file.mimetype,
    }).returning().get();

    db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: now, aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();
    relationshipService.computeScore(contactId);
    return result;
  },

  /**
   * Update an interaction's title and/or content.
   *
   * Only `title` and `content` are accepted — this is intentional.
   * Fields like `type`, `date`, and `contactId` are immutable after creation
   * to preserve audit-trail integrity. Any other keys in `body` are silently
   * ignored to prevent accidental data corruption.
   */
  updateInteraction(id: string, body: UpdateInteractionPayload) {
    const existing = db.select().from(schema.interactions).where(eq(schema.interactions.id, id)).get();
    if (!existing) return null;

    const { title, content } = body;
    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;

    if (Object.keys(updates).length === 0) return existing;

    updates.updatedAt = new Date().toISOString();

    const updated = db.update(schema.interactions)
      .set(updates)
      .where(eq(schema.interactions.id, id))
      .returning()
      .get();
      
    relationshipService.computeScore(existing.contactId);
    return updated;
  },

  deleteInteraction(id: string) {
    const existing = db.select().from(schema.interactions).where(eq(schema.interactions.id, id)).get();
    if (!existing) return false;

    if (existing.fileUrl?.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), existing.fileUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    db.delete(schema.interactions).where(eq(schema.interactions.id, id)).run();
    relationshipService.computeScore(existing.contactId);
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
