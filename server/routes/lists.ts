import { Router } from "express";
import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../logger.ts";
import { hydrateContact } from "../helpers.ts";

const router = Router();

router.get("/", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const lists = sqlite.prepare(`
      SELECT l.*, COUNT(lm.contactId) as memberCount
      FROM lists l
      LEFT JOIN list_members lm ON l.id = lm.listId
      GROUP BY l.id
      ORDER BY l.sortOrder ASC, l.createdAt ASC
    `).all();
    log.debug("API", `[${rid}] GET /api/lists → ${lists.length}`);
    res.json(lists);
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/lists failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch lists" });
  }
});

router.post("/", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { name, icon } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: "List name is required" });
    }
    const maxOrder = sqlite.prepare("SELECT MAX(sortOrder) as maxOrder FROM lists").get() as { maxOrder: number | null };
    const sortOrder = (maxOrder?.maxOrder ?? -1) + 1;
    const id = crypto.randomUUID();
    sqlite.prepare("INSERT INTO lists (id, name, icon, sortOrder) VALUES (?, ?, ?, ?)").run(
      id, name.trim(), icon || 'star', sortOrder
    );
    const list = sqlite.prepare("SELECT *, 0 as memberCount FROM lists WHERE id = ?").get(id);
    log.info("API", `[${rid}] POST /api/lists → "${name.trim()}" (${id})`);
    res.status(201).json(list);
  } catch (err: any) {
    log.error("API", `[${rid}] POST /api/lists failed`, { error: err.message });
    res.status(500).json({ error: "Failed to create list" });
  }
});

router.put("/reorder", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { orderedIds } = req.body as { orderedIds?: string[] };
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: "orderedIds array is required" });
    }
    const updateStmt = sqlite.prepare("UPDATE lists SET sortOrder = ? WHERE id = ?");
    const txn = sqlite.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        updateStmt.run(i, orderedIds[i]);
      }
    });
    txn();
    log.info("API", `[${rid}] PUT /api/lists/reorder → ${orderedIds.length} lists reordered`);
    res.json({ success: true });
  } catch (err: any) {
    log.error("API", `[${rid}] PUT /api/lists/reorder failed`, { error: err.message });
    res.status(500).json({ error: "Failed to reorder lists" });
  }
});

router.get("/:id/contacts", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { id } = req.params;
    const rows = sqlite.prepare(`
      SELECT c.* FROM contacts c
      JOIN list_members lm ON c.id = lm.contactId
      WHERE lm.listId = ?
      ORDER BY c.addedAt DESC
    `).all(id) as any[];
    log.debug("API", `[${rid}] GET /api/lists/${id}/contacts → ${rows.length} contacts`);
    res.json(rows.map(hydrateContact));
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/lists/${req.params.id}/contacts failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch list contacts" });
  }
});

router.delete("/:id", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT id, name FROM lists WHERE id = ?").get(id) as { id: string; name: string } | undefined;
    if (!existing) {
      log.warn("API", `[${rid}] DELETE /api/lists/${id} — not found (idempotent OK)`);
      return res.json({ success: true, message: "List not found (already deleted)" });
    }
    sqlite.prepare("DELETE FROM lists WHERE id = ?").run(id);
    log.info("API", `[${rid}] DELETE /api/lists/${id} → deleted "${existing.name}"`);
    res.json({ success: true, message: `Deleted list "${existing.name}"` });
  } catch (err: any) {
    log.error("API", `[${rid}] DELETE /api/lists/${req.params.id} failed`, { error: err.message });
    res.status(500).json({ error: "Failed to delete list" });
  }
});

router.post("/:id/members", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { id } = req.params;
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: "contactId is required" });

    const list = sqlite.prepare("SELECT id FROM lists WHERE id = ?").get(id);
    if (!list) return res.status(404).json({ error: "List not found" });

    const contact = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(contactId);
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)").run(id, contactId);
    log.info("API", `[${rid}] POST /api/lists/${id}/members → added ${contactId}`);
    res.json({ success: true });
  } catch (err: any) {
    log.error("API", `[${rid}] POST /api/lists/${req.params.id}/members failed`, { error: err.message });
    res.status(500).json({ error: "Failed to add member" });
  }
});

router.delete("/:id/members/:contactId", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { id, contactId } = req.params;
    sqlite.prepare("DELETE FROM list_members WHERE listId = ? AND contactId = ?").run(id, contactId);
    log.info("API", `[${rid}] DELETE /api/lists/${id}/members/${contactId} → removed`);
    res.json({ success: true });
  } catch (err: any) {
    log.error("API", `[${rid}] DELETE /api/lists/${req.params.id}/members/${req.params.contactId} failed`, { error: err.message });
    res.status(500).json({ error: "Failed to remove member" });
  }
});

export const listsRouter = router;
