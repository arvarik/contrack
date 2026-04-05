import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { log } from "../utils/logger.ts";
import { interactionService } from "../services/interactionService.ts";
import { validateBody, interactionCreateSchema } from "../utils/validators.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.get("/contacts/:id/timeline", asyncHandler(async (req, res) => {
  const items = interactionService.getTimeline(req.params.id);
  res.json(items);
}));

router.post("/contacts/:id/interactions", validateBody(interactionCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const result = interactionService.createInteraction(req.params.id, req.body);
  log.info("API", `[${rid}] POST interaction → ${req.body.type} "${req.body.title}"`);
  res.status(201).json(result);
}));

router.post("/contacts/:id/briefing", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const points = await interactionService.generateBriefing(req.params.id);
  if (!points) throw new AppError("Contact not found", 404);
  
  log.info("API", `[${rid}] POST briefing generated for ${req.params.id}`);
  res.json({ points });
}));

router.post("/contacts/:id/promote", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const updated = interactionService.promoteGhost(req.params.id);
  if (!updated) throw new AppError("Contact not found", 404);
  
  log.info("API", `[${rid}] Promoted ghost contact: ${updated.name}`);
  res.json(updated);
}));

router.post("/contacts/:id/attachments", upload.single("attachment"), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  if (!req.file) throw new AppError("No file", 400);

  const result = await interactionService.handleAttachment(req.params.id, req.file);
  log.info("API", `[${rid}] POST attachment → "${req.file.originalname}"`);
  res.status(201).json(result);
}));

router.patch("/interactions/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  
  if (Object.keys(req.body).length === 0) {
    throw new AppError("No valid fields to update", 400);
  }

  const result = interactionService.updateInteraction(req.params.id, req.body);
  if (!result) throw new AppError("Not found", 404);

  log.info("API", `[${rid}] PATCH interaction → ${req.params.id}`);
  res.json(result);
}));

router.delete("/interactions/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const success = interactionService.deleteInteraction(req.params.id);
  if (!success) throw new AppError("Not found", 404);

  log.info("API", `[${rid}] DELETE interaction → ${req.params.id}`);
  res.json({ success: true });
}));

router.get("/contacts/:id/relationships", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const limit = parseInt(req.query.limit as string) || 50;

  const rows = interactionService.getRelationships(req.params.id, limit);
  log.debug("API", `[${rid}] GET /api/contacts/${req.params.id}/relationships → ${rows.length}`);
  res.json(rows);
}));

export const interactionsRouter = router;
