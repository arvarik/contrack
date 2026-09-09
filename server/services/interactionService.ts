import { assertOwnedContact } from "./contactGuard.ts";
import crypto from "crypto";
import fs from "fs";
import { ownerUploadUrl, resolveUploadPath } from "../utils/paths.ts";
// @ts-expect-error no types available
import emlFormat from "eml-format";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { and, eq, sql } from "drizzle-orm";
import { log } from "../utils/logger.ts";
import {
  extractMentions,
  generateCatchMeUpBriefing,
  summarizeEmlEmail,
} from "../ai/aiService.ts";
import { relationshipService } from "./relationshipService.ts";
import { aiCache, contentHash } from "../utils/aiCache.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import type { Scope } from "../tenancy/scope.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { AppError } from "../utils/AppError.ts";
import { resolveCapability } from "../ai/capabilities.ts";
import { SharedWork } from "../ai/workQueue.ts";

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
 *
 * The scope arrives as an argument, not from the async context. A name the
 * model returns is matched against the caller's own contacts only, and a name
 * that matches nothing becomes a ghost the caller owns. Without the owner in
 * the match, a note saying "lunch with Sarah" would link to a stranger's
 * Sarah, and every later read of that mention would cross the boundary.
 */
async function runMentionExtraction(
  scope: Scope,
  interactionId: string,
  contactId: string,
  content: string,
): Promise<void> {
  try {
    const mentions = await extractMentions(content);
    if (!mentions || mentions.length === 0) return;

    const current = sqlite
      .prepare(
        "SELECT i.content FROM interactions i JOIN contacts c ON c.id = i.contactId WHERE i.id = ? AND i.ownerId = ? AND i.contactId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL",
      )
      .get(interactionId, scope.ownerId, contactId) as
      { content: string } | undefined;
    if (!current || current.content !== content) return;
    sqlite.transaction(() => {
      const mappedMentions = [];
      for (const m of mentions) {
        let existing = db
          .select()
          .from(schema.contacts)
          .where(
            and(
              eq(schema.contacts.name, m.name),
              eq(schema.contacts.ownerId, scope.ownerId),
            ),
          )
          .get();
        if (!existing) {
          const ghostId = crypto.randomUUID();
          const newTheme = ["brand", "indigo", "rose", "emerald", "amber"][
            Math.floor(Math.random() * 5)
          ];
          existing = db
            .insert(schema.contacts)
            .values({
              id: ghostId,
              name: m.name,
              company: m.company || null,
              isGhost: 1,
              themeColor: newTheme,
              ownerId: scope.ownerId,
            })
            .returning()
            .get();
          log.info("AI Service", `Inferred ghost contact: ${m.name}`);
        }
        mappedMentions.push({
          contactId: existing.id,
          name: existing.name,
          context: m.context,
          isGhost: existing.isGhost === 1,
        });
      }
      db.update(schema.interactions)
        .set({ mentions: JSON.stringify(mappedMentions) })
        .where(
          and(
            eq(schema.interactions.id, interactionId),
            eq(schema.interactions.ownerId, scope.ownerId),
          ),
        )
        .run();
    })();
  } catch (e: unknown) {
    log.error(
      "AI Service",
      `Background mention extraction failed for interaction ${interactionId}`,
      { error: getErrorMessage(e) },
    );
  }
}

const briefings = new SharedWork<string[]>();

function briefingSource(scope: Scope, contactId: string) {
  const contact = sqlite
    .prepare(
      "SELECT id, name, company, role, headline, about, location, preferences, lastContactedAt FROM contacts WHERE id = ? AND ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL",
    )
    .get(contactId, scope.ownerId) as Record<string, unknown> | undefined;
  if (!contact) throw new AppError("Contact is no longer available.", 404);
  const interactions = sqlite
    .prepare(
      "SELECT id, type, title, content, date FROM interactions WHERE contactId = ? AND ownerId = ? ORDER BY date DESC, id DESC LIMIT 15",
    )
    .all(contactId, scope.ownerId) as Record<string, unknown>[];
  return { contact, interactions };
}

export const interactionService = {
  getTimeline(scope: Scope, contactId: string) {
    // Every arm carries the owner. The timeline is a union of "interactions on
    // this contact" and "interactions that mention it", and the second arm
    // reaches through `interaction_mentions`, which has no owner column of its
    // own. `i.ownerId` gates both arms at the row that does have one.
    const raw = sqlite
      .prepare(
        `
      SELECT i.*, 
        CASE WHEN i.contactId != ? THEN original.name ELSE NULL END as isViaName,
        CASE WHEN i.contactId != ? THEN i.contactId ELSE NULL END as isViaId,
        (
          SELECT json_group_array(json_object('id', a.id, 'title', a.title, 'dueAt', a.dueAt, 'completedAt', a.completedAt)) 
          FROM action_items a WHERE a.interactionId = i.id AND a.ownerId = ?
        ) as actionItemsRaw
      FROM interactions i
      LEFT JOIN contacts original ON i.contactId = original.id AND original.ownerId = ?
      WHERE i.ownerId = ?
        AND (i.contactId = ? OR i.id IN (SELECT interactionId FROM interaction_mentions WHERE contactId = ?))
      ORDER BY i.date DESC
    `,
      )
      .all(
        contactId,
        contactId,
        scope.ownerId,
        scope.ownerId,
        scope.ownerId,
        contactId,
        contactId,
      ) as Array<Record<string, unknown>>;

    return raw.map((row) => {
      let actionItems = [];
      if (row.actionItemsRaw) {
        try {
          const parsed = JSON.parse(row.actionItemsRaw as string);
          // sqlite json_group_array returns '[{}]' even if null sometimes or '[null]'
          actionItems = parsed.filter(
            (p: Record<string, unknown>) => p && p.id,
          );
        } catch {}
      }
      delete row.actionItemsRaw;
      return { ...row, actionItems };
    });
  },

  createInteraction(
    scope: Scope,
    contactId: string,
    body: CreateInteractionPayload,
  ) {
    assertOwnedContact(scope, contactId);
    const { type, title, content, date, duration, source } = body;
    const id = crypto.randomUUID();
    const now = date || new Date().toISOString();

    const result = sqlite.transaction(() => {
      const res = db
        .insert(schema.interactions)
        .values({
          id,
          contactId,
          ownerId: scope.ownerId,
          type,
          title,
          content: content || null,
          date: now,
          duration: duration || null,
          source: source || null,
        })
        .returning()
        .get();

      if (content) {
        // Tolerate any attributes between data-type and data-id — TipTap does
        // not guarantee adjacency. (A previous version used `\\s`, which in a
        // regex literal matches a literal backslash + "s" and never matched.)
        const mentionRegex = /data-type="mention"[^>]*?data-id="([^"]+)"/g;
        const explicitMentionIds = [...content.matchAll(mentionRegex)].map(
          (m) => m[1],
        );
        if (explicitMentionIds.length > 0) {
          // These ids come from the request body. Before this they were
          // checked for existence alone, so any id at all linked a mention row
          // to a contact the caller cannot see. One scoped statement returns
          // the subset the caller owns, and the rest are dropped in silence:
          // reporting them would tell the caller which ids exist.
          const owned = contactRepo.findManyOwned(scope, explicitMentionIds);
          const insertStmt = sqlite.prepare(
            "INSERT OR IGNORE INTO interaction_mentions (interactionId, contactId) VALUES (?, ?)",
          );
          for (const row of owned) {
            // `deletedAt` is a state filter, not the boundary. The boundary is
            // the owner, and that came out of SQL above.
            if (row.deletedAt == null) insertStmt.run(id, row.id);
          }
        }
      }

      db.update(schema.contacts)
        .set({
          lastContactedAt: sql`(SELECT MAX(date) FROM interactions WHERE contactId = ${contactId} AND ownerId = ${scope.ownerId})`,
          updatedAt: new Date().toISOString(),
          aiBriefing: null,
          aiBriefingAt: null,
        })
        .where(
          and(
            eq(schema.contacts.id, contactId),
            eq(schema.contacts.ownerId, scope.ownerId),
          ),
        )
        .run();

      // Atomically create an action item if provided alongside the interaction
      if (body.actionItem && body.actionItem.title && body.actionItem.dueAt) {
        sqlite
          .prepare(
            `
          INSERT INTO action_items (id, contactId, ownerId, interactionId, title, dueAt)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            crypto.randomUUID(),
            contactId,
            scope.ownerId,
            id,
            body.actionItem.title,
            body.actionItem.dueAt,
          );
        log.info(
          "Interactions",
          `Created action item "${body.actionItem.title}" alongside interaction`,
        );
      }

      return res;
    })();
    // Schedule background ghost-contact extraction — never blocks the response.
    // The scope is captured here and passed in. AsyncLocalStorage does survive
    // a timer, but rule 7 wants the owner to be an argument of the job rather
    // than a property of whatever context happens to be current when it runs.
    if (content && process.env.DISABLE_BACKGROUND_JOBS !== "true") {
      setTimeout(() => {
        runWithContext(
          { requestId: `mentions-${id}`, principal: null, scope },
          () => {
            runMentionExtraction(scope, id, contactId, content);
          },
        );
      }, 0);
    }

    // Invalidate cached briefing for this contact — a new interaction means
    // any cached briefing is stale (it doesn't include this interaction)
    aiCache.invalidate("briefing", contactId);
    // TODO(2f): narrow to this owner once invalidateForOwner exists. A whole
    // tier flush is conservative, never wrong, and only costs other owners a
    // regeneration.
    aiCache.invalidate("dailyInsight");

    // Immediately recompute relationship score for this contact
    relationshipService.computeScore(contactId);

    return result;
  },

  async generateBriefing(
    scope: Scope,
    contactId: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const source = briefingSource(scope, contactId);
    const fingerprint = JSON.stringify(source);
    const model = resolveCapability("quick");
    const cacheKey = `${contactId}::${contentHash(JSON.stringify([source, model?.providerId, model?.model]))}`;
    const cached = aiCache.get<string[]>("briefing", cacheKey);
    if (cached) return cached;
    return briefings.run(
      cacheKey,
      async (budget) => {
        const points = await generateCatchMeUpBriefing(
          source.contact,
          source.interactions,
          budget,
        );
        budget.throwIfAborted();
        if (JSON.stringify(briefingSource(scope, contactId)) !== fingerprint)
          throw new AppError(
            "This contact changed during briefing generation. Try again.",
            409,
          );
        db.update(schema.contacts)
          .set({
            aiBriefing: JSON.stringify(points),
            aiBriefingAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.contacts.id, contactId),
              eq(schema.contacts.ownerId, scope.ownerId),
            ),
          )
          .run();
        aiCache.set("briefing", cacheKey, points);
        return points;
      },
      signal,
    );
  },

  promoteGhost(scope: Scope, contactId: string) {
    const contact = contactRepo.findOwned(scope, contactId);
    if (!contact) return null;

    return db
      .update(schema.contacts)
      .set({ isGhost: 0, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.contacts.id, contactId),
          eq(schema.contacts.ownerId, scope.ownerId),
        ),
      )
      .returning()
      .get();
  },

  async handleAttachment(
    scope: Scope,
    contactId: string,
    file: Express.Multer.File,
  ) {
    assertOwnedContact(scope, contactId);
    const now = new Date().toISOString();
    let content: string | null = null;
    const isEmail = file.originalname.toLowerCase().endsWith(".eml");
    if (isEmail) {
      const rawEml = await fs.promises.readFile(file.path, "utf8");
      const emlData = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          emlFormat.read(
            rawEml,
            (err: Error | null, data: Record<string, unknown>) => {
              if (err) reject(err);
              else resolve(data);
            },
          );
        },
      );
      content = await summarizeEmlEmail(
        String(emlData?.text || emlData?.html || rawEml),
      );
    }
    // The contact can disappear during email summarization.
    assertOwnedContact(scope, contactId);
    const result = sqlite.transaction(() => {
      const interaction = db
        .insert(schema.interactions)
        .values({
          id: crypto.randomUUID(),
          contactId,
          ownerId: scope.ownerId,
          type: isEmail ? "email" : "note",
          title: `${isEmail ? "Email Import" : "Attached File"}: ${file.originalname}`,
          date: now,
          content,
          fileUrl: ownerUploadUrl(scope.ownerId, "files", file.filename),
          fileName: file.originalname,
          fileType: isEmail ? "message/rfc822" : file.mimetype,
        })
        .returning()
        .get();
      db.update(schema.contacts)
        .set({
          lastContactedAt: now,
          updatedAt: now,
          aiBriefing: null,
          aiBriefingAt: null,
        })
        .where(
          and(
            eq(schema.contacts.id, contactId),
            eq(schema.contacts.ownerId, scope.ownerId),
          ),
        )
        .run();
      return interaction;
    })();
    aiCache.invalidate("briefing", contactId);
    // TODO(2f): narrow to this owner once invalidateForOwner exists.
    aiCache.invalidate("dailyInsight");
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
  updateInteraction(scope: Scope, id: string, body: UpdateInteractionPayload) {
    const existing = db
      .select()
      .from(schema.interactions)
      .where(
        and(
          eq(schema.interactions.id, id),
          eq(schema.interactions.ownerId, scope.ownerId),
        ),
      )
      .get();
    if (!existing) return null;
    assertOwnedContact(scope, existing.contactId);

    const { title, content } = body;
    const updates: {
      title?: string;
      content?: string | null;
      updatedAt?: string;
    } = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;

    if (Object.keys(updates).length === 0) return existing;

    updates.updatedAt = new Date().toISOString();

    const updated = db
      .update(schema.interactions)
      .set(updates)
      .where(
        and(
          eq(schema.interactions.id, id),
          eq(schema.interactions.ownerId, scope.ownerId),
        ),
      )
      .returning()
      .get();

    sqlite
      .prepare(
        "UPDATE contacts SET aiBriefing = NULL, aiBriefingAt = NULL WHERE id = ? AND ownerId = ?",
      )
      .run(existing.contactId, scope.ownerId);
    aiCache.invalidate("briefing", existing.contactId);
    // TODO(2f): narrow to this owner once invalidateForOwner exists.
    aiCache.invalidate("dailyInsight");
    relationshipService.computeScore(existing.contactId);
    return updated;
  },

  deleteInteraction(scope: Scope, id: string) {
    const existing = db
      .select()
      .from(schema.interactions)
      .where(
        and(
          eq(schema.interactions.id, id),
          eq(schema.interactions.ownerId, scope.ownerId),
        ),
      )
      .get();
    if (!existing) return false;
    assertOwnedContact(scope, existing.contactId);

    sqlite.transaction(() => {
      db.delete(schema.interactions)
        .where(
          and(
            eq(schema.interactions.id, id),
            eq(schema.interactions.ownerId, scope.ownerId),
          ),
        )
        .run();
      sqlite
        .prepare(
          "UPDATE contacts SET lastContactedAt = (SELECT MAX(date) FROM interactions WHERE contactId = ? AND ownerId = ?), aiBriefing = NULL, aiBriefingAt = NULL WHERE id = ? AND ownerId = ?",
        )
        .run(
          existing.contactId,
          scope.ownerId,
          existing.contactId,
          scope.ownerId,
        );
    })();
    aiCache.invalidate("briefing", existing.contactId);
    // TODO(2f): narrow to this owner once invalidateForOwner exists.
    aiCache.invalidate("dailyInsight");
    relationshipService.computeScore(existing.contactId);
    // The file goes only after the scoped delete succeeded. A delete that the
    // owner predicate refused must leave the attachment on disk.
    if (existing.fileUrl?.startsWith("/uploads/")) {
      const filePath = resolveUploadPath(existing.fileUrl);
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (error) {
        log.warn(
          "Interactions",
          `Attachment cleanup failed: ${getErrorMessage(error)}`,
        );
      }
    }
    return true;
  },

  getRelationships(scope: Scope, contactId: string, limit: number) {
    // The mention graph reaches sideways through `interaction_mentions`, which
    // carries no owner. Two of the three arms start at `interactions`, so they
    // gate on `i.ownerId`. The third starts at a mention row, so the outer
    // `c.ownerId` is what stops it, and it also covers the other two.
    return sqlite
      .prepare(
        `
      SELECT DISTINCT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.role, c.isGhost,
             COUNT(DISTINCT shared.interactionId) as sharedInteractions
      FROM (
        SELECT im.interactionId, im.contactId as relatedContactId
        FROM interactions i
        JOIN interaction_mentions im ON i.id = im.interactionId
        WHERE i.contactId = ? AND i.ownerId = ?
  
        UNION
  
        SELECT im2.interactionId, i2.contactId as relatedContactId
        FROM interaction_mentions im2
        JOIN interactions i2 ON im2.interactionId = i2.id
        WHERE im2.contactId = ? AND i2.ownerId = ?
  
        UNION
  
        SELECT im3.interactionId, im3.contactId as relatedContactId
        FROM interaction_mentions im3
        WHERE im3.interactionId IN (
          SELECT interactionId FROM interaction_mentions WHERE contactId = ?
        )
      ) shared
      JOIN contacts c ON shared.relatedContactId = c.id
      WHERE c.id != ? AND c.ownerId = ?
      GROUP BY c.id
      ORDER BY sharedInteractions DESC
      LIMIT ?
    `,
      )
      .all(
        contactId,
        scope.ownerId,
        contactId,
        scope.ownerId,
        contactId,
        contactId,
        scope.ownerId,
        limit,
      );
  },
};
