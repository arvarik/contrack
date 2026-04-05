import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { log } from "../utils/logger.ts";
import { contactService } from "../services/contactService.ts";
import { parseContactRecord } from "../ai/aiService.ts";
import { validateBody, contactCreateSchema, contactUpdateSchema, contactBulkCreateSchema } from "../utils/validators.ts";
import { z } from 'zod';
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const avatarDir = path.join(process.cwd(), "uploads", "avatars");
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap for avatars
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

const router = Router();

router.get("/contacts/map", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const results = contactService.getMapContacts();
  log.debug("API", `[${rid}] GET /api/contacts/map → ${results.length}`);
  res.json(results);
}));

router.get("/contacts/archived", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const results = contactService.getArchivedContacts();
  log.debug("API", `[${rid}] GET /api/contacts/archived → ${results.length}`);
  res.json(results);
}));

router.get("/contacts", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const view = req.query.view as string;

  if (view === 'slim') {
    const results = contactService.getSlimContacts();
    log.debug("API", `[${rid}] GET /api/contacts?view=slim → ${results.length} (slim)`);
    return res.json(results);
  }

  const results = contactService.getAllContacts();
  log.debug("API", `[${rid}] GET /api/contacts → ${results.length}`);
  res.json(results);
}));

router.get("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contact = contactService.getContactById(req.params.id);
  if (!contact) {
    log.warn("API", `[${rid}] 404 ${req.params.id}`); 
    throw new AppError("Not found", 404);
  }
  res.json(contact);
}));

router.post("/contacts", validateBody(contactCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  if (!req.body.name) throw new AppError("Name is required", 400);

  const contact = contactService.createContact(req.body);
  log.info("API", `[${rid}] POST /api/contacts → "${req.body.name}" (${contact?.id})`);
  res.status(201).json(contact);
}));

router.post("/contacts/bulk", validateBody(contactBulkCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const count = contactService.bulkCreateContacts(req.body);
  log.info("API", `[${rid}] POST /api/contacts/bulk → ${count} imported`);
  res.status(201).json({ success: true, count });
}));

router.post("/parse-contact", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { text } = req.body;
  if (!text) throw new AppError("Text is required", 400);
  const parsed = await parseContactRecord(text);
  log.info("API", `[${rid}] POST /api/parse-contact → parsed "${parsed.name}"`);
  res.json(parsed);
}));

router.post("/contacts/bulk-delete", validateBody(z.object({ ids: z.array(z.string().min(1)).min(1) })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const count = contactService.bulkDeleteContacts(req.body.ids);
  log.info("API", `[${rid}] POST /api/contacts/bulk-delete → ${count} deleted`);
  res.json({ success: true, count });
}));

router.put("/contacts/bulk-update", validateBody(z.object({ ids: z.array(z.string().min(1)).min(1), data: contactUpdateSchema })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const count = contactService.bulkUpdateContacts(req.body.ids, req.body.data);
  log.info("API", `[${rid}] PUT /api/contacts/bulk-update → ${count} updated`);
  res.json({ success: true, count });
}));

router.put("/contacts/:id", validateBody(contactUpdateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const updated = contactService.updateContact(req.params.id, req.body);
  if (!updated) throw new AppError("Not found", 404);
  log.info("API", `[${rid}] PUT /api/contacts/${req.params.id} → updated`);
  res.json(updated);
}));

router.patch("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const childKeys = ['emails', 'phones', 'socialLinks', 'tags', 'interests', 'addresses', 'attributes', 'education', 'experience', 'sources'];
  const hasChildArrays = childKeys.some(k => req.body[k] !== undefined);
  if (hasChildArrays) {
    throw new AppError("PATCH does not support child arrays. Use PUT for full updates.", 400);
  }

  const updated = contactService.patchContact(req.params.id, req.body);
  if (!updated) throw new AppError("Not found", 404);
  log.info("API", `[${rid}] PATCH /api/contacts/${req.params.id} → updated (scalar)`);
  res.json(updated);
}));

router.delete("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const success = contactService.deleteContact(req.params.id);
  if (!success) throw new AppError("Not found", 404);
  log.info("API", `[${rid}] DELETE /api/contacts/${req.params.id}`);
  res.json({ success: true });
}));

router.post("/contacts/:id/avatar", uploadAvatar.single("avatar"), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  if (!req.file) throw new AppError("No image file provided", 400);
  
  const updated = contactService.updateAvatar(req.params.id, req.file.filename, req.file.originalname);
  if (!updated) throw new AppError("Contact not found", 404);
  
  log.info("API", `[${rid}] POST /api/contacts/${req.params.id}/avatar → uploaded`);
  res.json(updated);
}));

export const contactsRouter = router;
