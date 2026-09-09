import { NotFoundError, ValidationError } from "../utils/AppError.ts";
import { ACTIVE_CONTACT_SQL } from "./search/ftsIndex.ts";
import crypto from "crypto";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { contactRepo } from "../repositories/contactRepository.ts";

interface ListRow {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  memberCount: number;
}

/**
 * Assert the scope owns this list, or 404.
 *
 * `list_members` carries no owner of its own, so every membership change has
 * to prove the list first. The 404 names no id and gives no reason, so a
 * foreign list id and an invented one look the same from outside.
 */
function requireOwnedList(scope: Scope, id: string): void {
  if (
    !sqlite
      .prepare("SELECT 1 FROM lists WHERE id = ? AND ownerId = ?")
      .get(id, scope.ownerId)
  ) {
    throw new NotFoundError("List");
  }
}

export const listService = {
  getAllLists(scope: Scope) {
    return sqlite
      .prepare(
        `
      SELECT l.*, COUNT(c.id) as memberCount
      FROM lists l
      LEFT JOIN list_members lm ON l.id = lm.listId
      LEFT JOIN contacts c ON c.id = lm.contactId AND c.ownerId = l.ownerId AND ${ACTIVE_CONTACT_SQL}
      WHERE l.ownerId = ?
      GROUP BY l.id
      ORDER BY l.sortOrder ASC, l.createdAt ASC
    `,
      )
      .all(scope.ownerId);
  },

  createList(scope: Scope, name: string, icon: string) {
    // Scoped, so each owner's lists number from zero. An instance-wide MAX
    // would hand a new account a sortOrder above every list on the box, which
    // leaks how much is stored and makes the first list sort oddly.
    const maxOrder = sqlite
      .prepare("SELECT MAX(sortOrder) as maxOrder FROM lists WHERE ownerId = ?")
      .get(scope.ownerId) as { maxOrder: number | null };
    const sortOrder = (maxOrder?.maxOrder ?? -1) + 1;
    const id = crypto.randomUUID();

    sqlite
      .prepare(
        "INSERT INTO lists (id, name, icon, sortOrder, ownerId) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, name.trim(), icon || "star", sortOrder, scope.ownerId);

    return sqlite
      .prepare(
        "SELECT *, 0 as memberCount FROM lists WHERE id = ? AND ownerId = ?",
      )
      .get(id, scope.ownerId) as ListRow;
  },

  updateList(scope: Scope, id: string, data: { name?: string; icon?: string }) {
    const existing = sqlite
      .prepare("SELECT id FROM lists WHERE id = ? AND ownerId = ?")
      .get(id, scope.ownerId);
    if (!existing) return null;

    const setClauses: string[] = [];
    const values: (string | number)[] = [];
    if (data.name !== undefined) {
      setClauses.push("name = ?");
      values.push(data.name.trim());
    }
    if (data.icon !== undefined) {
      setClauses.push("icon = ?");
      values.push(data.icon);
    }
    if (setClauses.length === 0) return existing;

    values.push(id, scope.ownerId);
    sqlite
      .prepare(
        `UPDATE lists SET ${setClauses.join(", ")} WHERE id = ? AND ownerId = ?`,
      )
      .run(...values);

    return sqlite
      .prepare(
        `
      SELECT l.*, COUNT(c.id) as memberCount
      FROM lists l
      LEFT JOIN list_members lm ON l.id = lm.listId
      LEFT JOIN contacts c ON c.id = lm.contactId AND c.ownerId = l.ownerId AND ${ACTIVE_CONTACT_SQL}
      WHERE l.id = ? AND l.ownerId = ?
      GROUP BY l.id
    `,
      )
      .get(id, scope.ownerId);
  },

  /**
   * Renumber the caller's lists.
   *
   * Two different refusals, and the order matters. An id the caller does not
   * own is a 404, the same answer an invented id gets. A set that is complete
   * for nobody, but built only from the caller's own ids, is still the 400
   * this endpoint has always returned.
   */
  reorderLists(scope: Scope, orderedIds: string[]) {
    const unique = [...new Set(orderedIds)];
    if (unique.length > 0) {
      const placeholders = unique.map(() => "?").join(",");
      const owned = sqlite
        .prepare(
          `SELECT COUNT(*) as n FROM lists WHERE ownerId = ? AND id IN (${placeholders})`,
        )
        .get(scope.ownerId, unique) as { n: number };
      if (owned.n !== unique.length) throw new NotFoundError("List");
    }

    const allIds = (
      sqlite
        .prepare("SELECT id FROM lists WHERE ownerId = ?")
        .all(scope.ownerId) as { id: string }[]
    ).map((row) => row.id);
    if (
      orderedIds.length !== allIds.length ||
      new Set(orderedIds).size !== allIds.length ||
      allIds.some((id) => !orderedIds.includes(id))
    ) {
      throw new ValidationError("Include each existing list exactly once");
    }
    const updateStmt = sqlite.prepare(
      "UPDATE lists SET sortOrder = ? WHERE id = ? AND ownerId = ?",
    );
    const txn = sqlite.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        updateStmt.run(i, orderedIds[i], scope.ownerId);
      }
    });
    txn();
    return orderedIds.length;
  },

  getListContacts(scope: Scope, id: string) {
    requireOwnedList(scope, id);
    const rows = sqlite
      .prepare(
        `
      SELECT c.* FROM contacts c
      JOIN list_members lm ON c.id = lm.contactId
      WHERE lm.listId = ? AND c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
      ORDER BY c.addedAt DESC
    `,
      )
      .all(id, scope.ownerId) as unknown[];
    return contactRepo.hydrateMany(rows);
  },

  deleteList(scope: Scope, id: string) {
    const existing = sqlite
      .prepare("SELECT id, name FROM lists WHERE id = ? AND ownerId = ?")
      .get(id, scope.ownerId) as { id: string; name: string } | undefined;
    if (!existing) return null;

    sqlite
      .prepare("DELETE FROM lists WHERE id = ? AND ownerId = ?")
      .run(id, scope.ownerId);
    return existing;
  },

  addMember(scope: Scope, listId: string, contactId: string) {
    requireOwnedList(scope, listId);

    const contact = sqlite
      .prepare(
        "SELECT id FROM contacts WHERE id = ? AND ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL",
      )
      .get(contactId, scope.ownerId);
    if (!contact) throw new NotFoundError("Contact");

    sqlite
      .prepare(
        "INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)",
      )
      .run(listId, contactId);
    return true;
  },

  /**
   * Remove one contact from one list.
   *
   * Both sides are checked. Before sub-phase 2b this checked nothing at all
   * and ran the DELETE on whatever pair of ids arrived, so any caller could
   * empty a list they had never seen.
   */
  removeMember(scope: Scope, listId: string, contactId: string) {
    requireOwnedList(scope, listId);
    if (!contactRepo.findOwned(scope, contactId))
      throw new NotFoundError("Contact");

    sqlite
      .prepare("DELETE FROM list_members WHERE listId = ? AND contactId = ?")
      .run(listId, contactId);
    return true;
  },

  /**
   * Add many contacts to one list.
   *
   * The list is checked once and the contacts in a single scoped statement.
   * A foreign id in the array aborts the whole call rather than being skipped,
   * which matches `addMember` and keeps the reported count honest.
   */
  bulkAddMembers(scope: Scope, listId: string, contactIds: string[]) {
    requireOwnedList(scope, listId);

    const unique = [...new Set(contactIds)];
    const owned = contactRepo.findManyOwned(scope, unique);
    const usable = owned.filter(
      (row) => row.deletedAt == null && row.canonicalId == null,
    );
    if (usable.length !== unique.length) throw new NotFoundError("Contact");

    let count = 0;
    const insertFn = sqlite.transaction(() => {
      const stmt = sqlite.prepare(
        "INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)",
      );
      for (const row of usable) count += stmt.run(listId, row.id).changes;
    });
    insertFn();
    return count;
  },
};
