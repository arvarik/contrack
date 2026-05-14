/**
 * Action Item Service — CRUD operations for follow-up tasks.
 *
 * Action items are first-class entities linked to contacts. SQL triggers on
 * the `action_items` table automatically keep `contacts.nextFollowUpAt` in
 * sync as MIN(dueAt) of pending items — no manual cache management needed.
 *
 * @module server/services/actionItemService
 */
import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";

export const actionItemService = {
  /**
   * Get all pending action items across all non-archived contacts,
   * enriched with contact info. Sorted by dueAt ascending (most urgent first).
   */
  getAllPending() {
    return sqlite
      .prepare(
        `
      SELECT ai.*, 
             c.name as contactName, c.company as contactCompany,
             c.avatarUrl as contactAvatarUrl, c.themeColor as contactThemeColor
      FROM action_items ai
      JOIN contacts c ON ai.contactId = c.id
      WHERE ai.completedAt IS NULL
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
      ORDER BY ai.dueAt ASC
    `,
      )
      .all();
  },

  /**
   * Get recently completed action items (last 50).
   */
  getRecentlyCompleted() {
    return sqlite
      .prepare(
        `
      SELECT ai.*, 
             c.name as contactName, c.company as contactCompany,
             c.avatarUrl as contactAvatarUrl, c.themeColor as contactThemeColor
      FROM action_items ai
      JOIN contacts c ON ai.contactId = c.id
      WHERE ai.completedAt IS NOT NULL
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
      ORDER BY ai.completedAt DESC
      LIMIT 50
    `,
      )
      .all();
  },

  /**
   * Count of overdue + due-today items for the sidebar badge.
   * Only counts items where dueAt <= today (inclusive).
   */
  getUrgentCount(): number {
    const row = sqlite
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM action_items ai
      JOIN contacts c ON ai.contactId = c.id
      WHERE ai.completedAt IS NULL
        AND date(ai.dueAt) <= date('now')
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
    `,
      )
      .get() as { count: number };
    return row.count;
  },

  /**
   * Get all action items for a specific contact (pending first, then completed).
   */
  getByContactId(contactId: string) {
    return sqlite
      .prepare(
        `
      SELECT * FROM action_items
      WHERE contactId = ?
      ORDER BY completedAt IS NULL DESC, dueAt ASC
    `,
      )
      .all(contactId);
  },

  /**
   * Create a new action item. The SQL trigger auto-updates contacts.nextFollowUpAt.
   */
  create(contactId: string, title: string, dueAt: string) {
    const id = crypto.randomUUID();
    sqlite
      .prepare(
        `
      INSERT INTO action_items (id, contactId, title, dueAt)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(id, contactId, title, dueAt);

    log.info(
      "ActionItems",
      `Created "${title}" for contact ${contactId} due ${dueAt}`,
    );
    return sqlite.prepare("SELECT * FROM action_items WHERE id = ?").get(id);
  },

  /**
   * Update an action item (snooze = update dueAt, or edit title).
   * The sync trigger recomputes contacts.nextFollowUpAt automatically.
   */
  update(id: string, updates: { dueAt?: string; title?: string }) {
    const existing = sqlite
      .prepare("SELECT * FROM action_items WHERE id = ?")
      .get(id) as any;
    if (!existing) return null;

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.dueAt !== undefined) {
      setClauses.push("dueAt = ?");
      values.push(updates.dueAt);
    }
    if (updates.title !== undefined) {
      setClauses.push("title = ?");
      values.push(updates.title);
    }

    if (setClauses.length === 0) return existing;

    setClauses.push("updatedAt = datetime('now')");
    values.push(id);

    sqlite
      .prepare(`UPDATE action_items SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values);

    log.info(
      "ActionItems",
      `Updated ${id}${updates.dueAt ? ` → due ${updates.dueAt}` : ""}`,
    );
    return sqlite.prepare("SELECT * FROM action_items WHERE id = ?").get(id);
  },

  /**
   * Mark an action item as completed. Sets completedAt to now.
   * The sync trigger recomputes contacts.nextFollowUpAt to the next pending item.
   */
  complete(id: string) {
    const existing = sqlite
      .prepare("SELECT * FROM action_items WHERE id = ?")
      .get(id) as any;
    if (!existing) return null;
    if (existing.completedAt) return existing; // Already completed — idempotent

    sqlite
      .prepare(
        `
      UPDATE action_items SET completedAt = datetime('now'), updatedAt = datetime('now')
      WHERE id = ?
    `,
      )
      .run(id);

    log.info("ActionItems", `Completed "${existing.title}" (${id})`);
    return sqlite.prepare("SELECT * FROM action_items WHERE id = ?").get(id);
  },

  /**
   * Permanently delete an action item. Trigger recomputes the cache.
   */
  delete(id: string): boolean {
    const existing = sqlite
      .prepare("SELECT * FROM action_items WHERE id = ?")
      .get(id) as any;
    if (!existing) return false;

    sqlite.prepare("DELETE FROM action_items WHERE id = ?").run(id);
    log.info("ActionItems", `Deleted "${existing.title}" (${id})`);
    return true;
  },
};
