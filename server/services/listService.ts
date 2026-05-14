import crypto from "crypto";
import { sqlite } from "../db.ts";
import { contactRepo } from "../repositories/contactRepository.ts";

export const listService = {
  getAllLists() {
    return sqlite
      .prepare(
        `
      SELECT l.*, COUNT(lm.contactId) as memberCount
      FROM lists l
      LEFT JOIN list_members lm ON l.id = lm.listId
      GROUP BY l.id
      ORDER BY l.sortOrder ASC, l.createdAt ASC
    `,
      )
      .all();
  },

  createList(name: string, icon: string) {
    const maxOrder = sqlite
      .prepare("SELECT MAX(sortOrder) as maxOrder FROM lists")
      .get() as { maxOrder: number | null };
    const sortOrder = (maxOrder?.maxOrder ?? -1) + 1;
    const id = crypto.randomUUID();

    sqlite
      .prepare(
        "INSERT INTO lists (id, name, icon, sortOrder) VALUES (?, ?, ?, ?)",
      )
      .run(id, name.trim(), icon || "star", sortOrder);

    return sqlite
      .prepare("SELECT *, 0 as memberCount FROM lists WHERE id = ?")
      .get(id);
  },

  updateList(id: string, data: { name?: string; icon?: string }) {
    const existing = sqlite
      .prepare("SELECT id FROM lists WHERE id = ?")
      .get(id);
    if (!existing) return null;

    const setClauses: string[] = [];
    const values: any[] = [];
    if (data.name !== undefined) {
      setClauses.push("name = ?");
      values.push(data.name.trim());
    }
    if (data.icon !== undefined) {
      setClauses.push("icon = ?");
      values.push(data.icon);
    }
    if (setClauses.length === 0) return existing;

    values.push(id);
    sqlite
      .prepare(`UPDATE lists SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values);

    return sqlite
      .prepare(
        `
      SELECT l.*, COUNT(lm.contactId) as memberCount
      FROM lists l
      LEFT JOIN list_members lm ON l.id = lm.listId
      WHERE l.id = ?
      GROUP BY l.id
    `,
      )
      .get(id);
  },

  reorderLists(orderedIds: string[]) {
    const updateStmt = sqlite.prepare(
      "UPDATE lists SET sortOrder = ? WHERE id = ?",
    );
    const txn = sqlite.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        updateStmt.run(i, orderedIds[i]);
      }
    });
    txn();
    return orderedIds.length;
  },

  getListContacts(id: string) {
    const rows = sqlite
      .prepare(
        `
      SELECT c.* FROM contacts c
      JOIN list_members lm ON c.id = lm.contactId
      WHERE lm.listId = ?
      ORDER BY c.addedAt DESC
    `,
      )
      .all(id) as any[];
    return contactRepo.hydrateMany(rows);
  },

  deleteList(id: string) {
    const existing = sqlite
      .prepare("SELECT id, name FROM lists WHERE id = ?")
      .get(id) as { id: string; name: string } | undefined;
    if (!existing) return null;

    sqlite.prepare("DELETE FROM lists WHERE id = ?").run(id);
    return existing;
  },

  addMember(listId: string, contactId: string) {
    const list = sqlite
      .prepare("SELECT id FROM lists WHERE id = ?")
      .get(listId);
    if (!list) throw new Error("List not found");

    const contact = sqlite
      .prepare("SELECT id FROM contacts WHERE id = ?")
      .get(contactId);
    if (!contact) throw new Error("Contact not found");

    sqlite
      .prepare(
        "INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)",
      )
      .run(listId, contactId);
    return true;
  },

  removeMember(listId: string, contactId: string) {
    sqlite
      .prepare("DELETE FROM list_members WHERE listId = ? AND contactId = ?")
      .run(listId, contactId);
    return true;
  },

  bulkAddMembers(listId: string, contactIds: string[]) {
    const list = sqlite
      .prepare("SELECT id FROM lists WHERE id = ?")
      .get(listId);
    if (!list) throw new Error("List not found");

    const insertFn = sqlite.transaction(() => {
      const stmt = sqlite.prepare(
        "INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)",
      );
      for (const contactId of contactIds) stmt.run(listId, contactId);
    });
    insertFn();
    return contactIds.length;
  },
};
