import { Router } from "express";
import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../logger.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { validateBody, listCreateSchema } from "../utils/validators.ts";
import { z } from "zod";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const lists = sqlite.prepare(`
    SELECT l.*, COUNT(lm.contactId) as memberCount
    FROM lists l
    LEFT JOIN list_members lm ON l.id = lm.listId
    GROUP BY l.id
    ORDER BY l.sortOrder ASC, l.createdAt ASC
  `).all();
  log.debug("API", `[${rid}] GET /api/lists → ${lists.length}`);
  res.json(lists);
}));

router.post("/", validateBody(listCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { name, icon } = req.body;
  const maxOrder = sqlite.prepare("SELECT MAX(sortOrder) as maxOrder FROM lists").get() as { maxOrder: number | null };
  const sortOrder = (maxOrder?.maxOrder ?? -1) + 1;
  const id = crypto.randomUUID();
  sqlite.prepare("INSERT INTO lists (id, name, icon, sortOrder) VALUES (?, ?, ?, ?)").run(
    id, name.trim(), icon || 'star', sortOrder
  );
  const list = sqlite.prepare("SELECT *, 0 as memberCount FROM lists WHERE id = ?").get(id);
  log.info("API", `[${rid}] POST /api/lists → "${name.trim()}" (${id})`);
  res.status(201).json(list);
}));

router.put("/reorder", validateBody(z.object({ orderedIds: z.array(z.string()) })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { orderedIds } = req.body;
  const updateStmt = sqlite.prepare("UPDATE lists SET sortOrder = ? WHERE id = ?");
  const txn = sqlite.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      updateStmt.run(i, orderedIds[i]);
    }
  });
  txn();
  log.info("API", `[${rid}] PUT /api/lists/reorder → ${orderedIds.length} lists reordered`);
  res.json({ success: true });
}));

router.get("/:id/contacts", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { id } = req.params;
  const rows = sqlite.prepare(`
    SELECT c.* FROM contacts c
    JOIN list_members lm ON c.id = lm.contactId
    WHERE lm.listId = ?
    ORDER BY c.addedAt DESC
  `).all(id) as any[];
  log.debug("API", `[${rid}] GET /api/lists/${id}/contacts → ${rows.length} contacts`);
  res.json(contactRepo.hydrateMany(rows));
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { id } = req.params;
  const existing = sqlite.prepare("SELECT id, name FROM lists WHERE id = ?").get(id) as { id: string; name: string } | undefined;
  if (!existing) {
    log.warn("API", `[${rid}] DELETE /api/lists/${id} — not found (idempotent OK)`);
    return res.json({ success: true, message: "List not found (already deleted)" });
  }
  sqlite.prepare("DELETE FROM lists WHERE id = ?").run(id);
  log.info("API", `[${rid}] DELETE /api/lists/${id} → deleted "${existing.name}"`);
  res.json({ success: true, message: `Deleted list "${existing.name}"` });
}));

router.post("/:id/members", validateBody(z.object({ contactId: z.string() })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { id } = req.params;
  const { contactId } = req.body;

  const list = sqlite.prepare("SELECT id FROM lists WHERE id = ?").get(id);
  if (!list) throw new AppError("List not found", 404);

  const contact = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(contactId);
  if (!contact) throw new AppError("Contact not found", 404);

  sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)").run(id, contactId);
  log.info("API", `[${rid}] POST /api/lists/${id}/members → added ${contactId}`);
  res.json({ success: true });
}));

router.delete("/:id/members/:contactId", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { id, contactId } = req.params;
  sqlite.prepare("DELETE FROM list_members WHERE listId = ? AND contactId = ?").run(id, contactId);
  log.info("API", `[${rid}] DELETE /api/lists/${id}/members/${contactId} → removed`);
  res.json({ success: true });
}));

router.post("/:id/members/bulk", validateBody(z.object({ contactIds: z.array(z.string()).min(1) })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { id } = req.params;
  const { contactIds } = req.body;

  const list = sqlite.prepare("SELECT id FROM lists WHERE id = ?").get(id);
  if (!list) throw new AppError("List not found", 404);

  const insertFn = sqlite.transaction(() => {
    const stmt = sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)");
    for (const contactId of contactIds) stmt.run(id, contactId);
  });
  insertFn();
  log.info("API", `[${rid}] POST /api/lists/${id}/members/bulk → added ${contactIds.length}`);
  res.json({ success: true, count: contactIds.length });
}));

export const listsRouter = router;
