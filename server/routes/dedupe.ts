import { Router } from "express";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { log } from "../utils/logger.ts";
import { dedupeService } from "../services/dedupeService.ts";

const router = Router();

router.get("/dedupe/suggestions", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const suggestions = await dedupeService.getSuggestions(rid);
  log.info("API", `[${rid}] GET /api/dedupe/suggestions → ${suggestions.length} suggestions`);
  res.json(suggestions);
}));

router.post("/contacts/merge", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { primaryId, duplicateId } = req.body;
  
  if (!primaryId || !duplicateId) {
    throw new AppError("primaryId and duplicateId are required", 400);
  }
  if (primaryId === duplicateId) {
    throw new AppError("Cannot merge a contact with itself", 400);
  }

  try {
    const merged = dedupeService.mergeContacts(primaryId, duplicateId, rid);
    log.info("API", `[${rid}] POST /api/contacts/merge → merged ${duplicateId} into ${primaryId}`);
    res.json({ success: true, contact: merged });
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }
}));

if (process.env.NODE_ENV !== 'production') {
  router.post("/dev/seed-duplicates", asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    dedupeService.seedDuplicates();
    log.info("API", `[${rid}] POST /api/dev/seed-duplicates → Seeded duplicate pair`);
    res.json({ success: true, message: "Seeded 1 duplicate pair" });
  }));
}

export const dedupeRouter = router;
