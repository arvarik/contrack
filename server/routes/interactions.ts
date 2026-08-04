import { Router } from "express";
import path from "path";
import multer from "multer";
import { log } from "../utils/logger.ts";
import { interactionService } from "../services/interactionService.ts";
import {
  validateBody,
  interactionCreateSchema,
  interactionUpdateSchema,
} from "../utils/validators.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { UPLOADS_DIR, ensureDir } from "../utils/paths.ts";

const uploadDir = UPLOADS_DIR;
ensureDir(uploadDir);

// Attachment extensions we accept. Script-capable types (.html, .svg, .xhtml,
// .js, …) are excluded — uploads are served from the app origin, so a stored
// HTML file would execute as same-origin script.
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  ".eml",
  ".txt",
  ".md",
  ".csv",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) return cb(null, true);
    cb(
      new AppError(`File type "${ext || "unknown"}" is not allowed`, 400, {
        code: "UNSUPPORTED_FILE_TYPE",
      }),
    );
  },
});

const router = Router();

router.get(
  "/contacts/:id/timeline",
  asyncHandler(async (req, res) => {
    const items = interactionService.getTimeline(String(req.params.id));
    res.json(items);
  }),
);

router.post(
  "/contacts/:id/interactions",
  validateBody(interactionCreateSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const result = interactionService.createInteraction(
      String(req.params.id),
      req.body,
    );
    log.info(
      "API",
      `[${rid}] POST interaction → ${req.body.type} "${req.body.title}"`,
    );
    res.status(201).json(result);
  }),
);

router.post(
  "/contacts/:id/briefing",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const points = await interactionService.generateBriefing(
      String(req.params.id),
    );
    if (!points) throw new AppError("Contact not found", 404);

    log.info(
      "API",
      `[${rid}] POST briefing generated for ${String(req.params.id)}`,
    );
    res.json({ points });
  }),
);

router.post(
  "/contacts/:id/promote",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const updated = interactionService.promoteGhost(String(req.params.id));
    if (!updated) throw new AppError("Contact not found", 404);

    log.info("API", `[${rid}] Promoted ghost contact: ${updated.name}`);
    res.json(updated);
  }),
);

router.post(
  "/contacts/:id/attachments",
  upload.single("attachment"),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    if (!req.file) throw new AppError("No file", 400);

    const result = await interactionService.handleAttachment(
      String(req.params.id),
      req.file,
    );
    log.info("API", `[${rid}] POST attachment → "${req.file.originalname}"`);
    res.status(201).json(result);
  }),
);

router.patch(
  "/interactions/:id",
  validateBody(interactionUpdateSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const result = interactionService.updateInteraction(
      String(req.params.id),
      req.body,
    );
    if (!result) throw new AppError("Not found", 404);

    log.info("API", `[${rid}] PATCH interaction → ${String(req.params.id)}`);
    res.json(result);
  }),
);

router.delete(
  "/interactions/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const success = interactionService.deleteInteraction(String(req.params.id));
    if (!success) throw new AppError("Not found", 404);

    log.info("API", `[${rid}] DELETE interaction → ${String(req.params.id)}`);
    res.json({ success: true });
  }),
);

router.get(
  "/contacts/:id/relationships",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const limit = parseInt(req.query.limit as string) || 50;

    const rows = interactionService.getRelationships(
      String(req.params.id),
      limit,
    );
    log.debug(
      "API",
      `[${rid}] GET /api/contacts/${String(req.params.id)}/relationships → ${rows.length}`,
    );
    res.json(rows);
  }),
);

export const interactionsRouter = router;
