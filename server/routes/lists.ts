import { Router } from "express";
import { log } from "../utils/logger.ts";
import { listService } from "../services/listService.ts";
import { validateBody, listCreateSchema } from "../utils/validators.ts";
import { z } from "zod";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const lists = listService.getAllLists();
  log.debug("API", `[${rid}] GET /api/lists → ${lists.length}`);
  res.json(lists);
}));

router.post("/", validateBody(listCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { name, icon } = req.body;
  
  const list = listService.createList(name, icon);
  log.info("API", `[${rid}] POST /api/lists → "${name.trim()}" (${(list as any).id})`);
  res.status(201).json(list);
}));

router.put("/reorder", validateBody(z.object({ orderedIds: z.array(z.string()) })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const count = listService.reorderLists(req.body.orderedIds);
  log.info("API", `[${rid}] PUT /api/lists/reorder → ${count} lists reordered`);
  res.json({ success: true });
}));

router.get("/:id/contacts", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contacts = listService.getListContacts(req.params.id);
  log.debug("API", `[${rid}] GET /api/lists/${req.params.id}/contacts → ${contacts.length} contacts`);
  res.json(contacts);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const deleted = listService.deleteList(req.params.id);
  
  if (!deleted) {
    log.warn("API", `[${rid}] DELETE /api/lists/${req.params.id} — not found (idempotent OK)`);
    return res.json({ success: true, message: "List not found (already deleted)" });
  }
  
  log.info("API", `[${rid}] DELETE /api/lists/${req.params.id} → deleted "${deleted.name}"`);
  res.json({ success: true, message: `Deleted list "${deleted.name}"` });
}));

router.post("/:id/members", validateBody(z.object({ contactId: z.string() })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  listService.addMember(req.params.id, req.body.contactId);
  log.info("API", `[${rid}] POST /api/lists/${req.params.id}/members → added ${req.body.contactId}`);
  res.json({ success: true });
}));

router.delete("/:id/members/:contactId", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  listService.removeMember(req.params.id, req.params.contactId);
  log.info("API", `[${rid}] DELETE /api/lists/${req.params.id}/members/${req.params.contactId} → removed`);
  res.json({ success: true });
}));

router.post("/:id/members/bulk", validateBody(z.object({ contactIds: z.array(z.string()).min(1) })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const count = listService.bulkAddMembers(req.params.id, req.body.contactIds);
  log.info("API", `[${rid}] POST /api/lists/${req.params.id}/members/bulk → added ${count}`);
  res.json({ success: true, count });
}));

export const listsRouter = router;
