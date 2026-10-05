import { assertOwnedContact } from "./contactGuard.ts";
/**
 * Action Item Service — CRUD operations for follow-up tasks.
 *
 * Action items are first-class entities linked to contacts. SQL triggers on
 * the `action_items` table automatically keep `contacts.nextFollowUpAt` in
 * sync as MIN(dueAt) of pending items — no manual cache management needed.
 * Every function takes the caller's scope first, and the
 * owner predicate sits on `action_items` rather than on the joined contact.
 * The join stays for the payload columns and the archived filter, but the
 * index that answers the query is `idx_action_items_owner_due` (partial, on
 * pending rows) or `idx_action_items_owner_done`.
 *
 * @module server/services/actionItemService
 */
import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { NotFoundError } from "../utils/AppError.ts";
import type { Scope } from "../tenancy/scope.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { dispatchEvents, recordEvent } from "../events/index.ts";

/**
 * Narrow action_items row shape — only the columns the mutation guards
 * below actually read (rows come from `SELECT *` but are treated narrowly).
 */
interface ActionItemRow {
  id: string;
  contactId: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
}

/** One action item the scope owns, or undefined. */
function findOwnedItem(scope: Scope, id: string): ActionItemRow | undefined {
  return sqlite
    .prepare("SELECT * FROM action_items WHERE id = ? AND ownerId = ?")
    .get(id, scope.ownerId) as ActionItemRow | undefined;
}

export const actionItemService = {
  /**
   * Get all pending action items across all non-archived contacts,
   * enriched with contact info. Sorted by dueAt ascending (most urgent first).
   */
  getAllPending(scope: Scope) {
    return sqlite
      .prepare(
        `
      SELECT ai.*, 
             c.name as contactName, c.company as contactCompany,
             c.avatarUrl as contactAvatarUrl, c.themeColor as contactThemeColor
      FROM action_items ai
      JOIN contacts c ON ai.contactId = c.id
      WHERE ai.ownerId = ?
        AND ai.completedAt IS NULL
        AND c.deletedAt IS NULL
        AND c.canonicalId IS NULL
        AND c.isGhost = 0
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
      ORDER BY ai.dueAt ASC
    `,
      )
      .all(scope.ownerId);
  },

  /**
   * Get recently completed action items (last 50).
   */
  getRecentlyCompleted(scope: Scope) {
    return sqlite
      .prepare(
        `
      SELECT ai.*, 
             c.name as contactName, c.company as contactCompany,
             c.avatarUrl as contactAvatarUrl, c.themeColor as contactThemeColor
      FROM action_items ai
      JOIN contacts c ON ai.contactId = c.id
      WHERE ai.ownerId = ?
        AND ai.completedAt IS NOT NULL
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
      ORDER BY ai.completedAt DESC
      LIMIT 50
    `,
      )
      .all(scope.ownerId);
  },

  /**
   * Count of overdue + due-today items for the sidebar badge.
   * Only counts items where dueAt <= today (inclusive).
   */
  getUrgentCount(scope: Scope): number {
    const row = sqlite
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM action_items ai
      JOIN contacts c ON ai.contactId = c.id
      WHERE ai.ownerId = ?
        AND ai.completedAt IS NULL
        AND date(ai.dueAt) <= date('now')
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
    `,
      )
      .get(scope.ownerId) as { count: number };
    return row.count;
  },

  /**
   * Get all action items for a specific contact (pending first, then completed).
   */
  getByContactId(scope: Scope, contactId: string) {
    return sqlite
      .prepare(
        `
      SELECT * FROM action_items
      WHERE contactId = ? AND ownerId = ?
      ORDER BY completedAt IS NULL DESC, dueAt ASC
    `,
      )
      .all(contactId, scope.ownerId);
  },

  /**
   * Create a new action item. The SQL trigger auto-updates contacts.nextFollowUpAt.
   */
  create(scope: Scope, contactId: string, title: string, dueAt: string) {
    assertOwnedContact(scope, contactId);
    const id = crypto.randomUUID();
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `
      INSERT INTO action_items (id, contactId, ownerId, title, dueAt)
      VALUES (?, ?, ?, ?, ?)
    `,
        )
        .run(id, contactId, scope.ownerId, title, dueAt);
      recordEvent(scope, "action_item.created", id, {
        contactId,
        interactionId: null,
      });
    })();
    dispatchEvents();

    log.info(
      "ActionItems",
      `Created ${id} for contact ${contactId} due ${dueAt}`,
    );
    return findOwnedItem(scope, id);
  },

  /**
   * The same action item for many contacts, in one transaction. One id the
   * scope cannot use refuses the whole call, as `bulkAddMembers` does.
   */
  createMany(
    scope: Scope,
    contactIds: string[],
    title: string,
    dueAt: string,
  ): number {
    const unique = [...new Set(contactIds)];
    const usable = contactRepo
      .findManyOwned(scope, unique)
      .filter((row) => row.deletedAt == null && row.canonicalId == null);
    if (usable.length !== unique.length) throw new NotFoundError("Contact");

    const insert = sqlite.prepare(
      "INSERT INTO action_items (id, contactId, ownerId, title, dueAt) VALUES (?, ?, ?, ?, ?)",
    );
    sqlite.transaction(() => {
      for (const { id: contactId } of usable) {
        const id = crypto.randomUUID();
        insert.run(id, contactId, scope.ownerId, title, dueAt);
        recordEvent(scope, "action_item.created", id, {
          contactId,
          interactionId: null,
        });
      }
    })();
    dispatchEvents();

    log.info(
      "ActionItems",
      `Created one follow-up for ${usable.length} contacts due ${dueAt}`,
    );
    return usable.length;
  },

  /**
   * Update an action item (snooze = update dueAt, or edit title).
   * The sync trigger recomputes contacts.nextFollowUpAt automatically.
   */
  update(
    scope: Scope,
    id: string,
    updates: { dueAt?: string; title?: string },
  ) {
    const existing = findOwnedItem(scope, id);
    if (!existing) return null;
    assertOwnedContact(scope, existing.contactId);

    const setClauses: string[] = [];
    const values: string[] = [];
    const changed: string[] = [];

    if (updates.dueAt !== undefined) {
      setClauses.push("dueAt = ?");
      values.push(updates.dueAt);
      changed.push("dueAt");
    }
    if (updates.title !== undefined) {
      setClauses.push("title = ?");
      values.push(updates.title);
      changed.push("title");
    }

    if (setClauses.length === 0) return existing;

    setClauses.push("updatedAt = datetime('now')");
    values.push(id, scope.ownerId);

    sqlite.transaction(() => {
      sqlite
        .prepare(
          `UPDATE action_items SET ${setClauses.join(", ")} WHERE id = ? AND ownerId = ?`,
        )
        .run(...values);
      recordEvent(scope, "action_item.updated", id, {
        contactId: existing.contactId,
        changed,
      });
    })();
    dispatchEvents();

    log.info(
      "ActionItems",
      `Updated ${id}${updates.dueAt ? ` → due ${updates.dueAt}` : ""}`,
    );
    return findOwnedItem(scope, id);
  },

  /**
   * Mark an action item as completed. Sets completedAt to now.
   * The sync trigger recomputes contacts.nextFollowUpAt to the next pending item.
   */
  complete(scope: Scope, id: string) {
    const existing = findOwnedItem(scope, id);
    if (!existing) return null;
    assertOwnedContact(scope, existing.contactId);
    if (existing.completedAt) return existing; // Already completed — idempotent

    sqlite.transaction(() => {
      sqlite
        .prepare(
          `
      UPDATE action_items SET completedAt = datetime('now'), updatedAt = datetime('now')
      WHERE id = ? AND ownerId = ?
    `,
        )
        .run(id, scope.ownerId);
      recordEvent(scope, "action_item.completed", id, {
        contactId: existing.contactId,
      });
    })();
    dispatchEvents();

    log.info("ActionItems", `Completed ${id}`);
    return findOwnedItem(scope, id);
  },

  /**
   * Permanently delete an action item. Trigger recomputes the cache.
   */
  delete(scope: Scope, id: string): boolean {
    const existing = findOwnedItem(scope, id);
    if (!existing) return false;
    assertOwnedContact(scope, existing.contactId);

    sqlite.transaction(() => {
      sqlite
        .prepare("DELETE FROM action_items WHERE id = ? AND ownerId = ?")
        .run(id, scope.ownerId);
      recordEvent(scope, "action_item.deleted", id, {
        contactId: existing.contactId,
      });
    })();
    dispatchEvents();
    log.info("ActionItems", `Deleted ${id}`);
    return true;
  },
};
