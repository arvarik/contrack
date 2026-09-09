import fs from "node:fs";
import { getErrorMessage } from "../utils/helpers.ts";
import { requireContact } from "../services/contactGuard.ts";
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
import { AppError, NotFoundError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { ensureDir, ownerUploadDir } from "../utils/paths.ts";
import { scopeOf } from "../tenancy/scope.ts";

// Attachments go to uploads/u/<ownerId>/files/ now. The destination callback
// creates the caller's directory; there is no shared one to make here.

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
  // See the note on the avatar storage in routes/contacts.ts: the owner is
  // read from req.principal rather than the async context.
  destination: (req, _file, cb) => {
    const owner = req.principal?.user.id;
    if (!owner) return cb(new Error("No principal for a file upload"), "");
    const dir = ownerUploadDir(owner, "files");
    ensureDir(dir);
    cb(null, dir);
  },
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
  requireContact,
  asyncHandler(async (req, res) => {
    const items = interactionService.getTimeline(
      scopeOf(req),
      String(req.params.id),
    );
    res.json(items);
  }),
);

router.post(
  "/contacts/:id/interactions",
  requireContact,
  validateBody(interactionCreateSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const result = interactionService.createInteraction(
      scopeOf(req),
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
  requireContact,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    let points;
    try {
      points = await interactionService.generateBriefing(
        scopeOf(req),
        String(req.params.id),
        controller.signal,
      );
    } finally {
      res.off("close", onClose);
    }
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
  requireContact,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const updated = interactionService.promoteGhost(
      scopeOf(req),
      String(req.params.id),
    );
    if (!updated) throw new AppError("Contact not found", 404);

    log.info("API", `[${rid}] Promoted ghost contact: ${updated.name}`);
    res.json(updated);
  }),
);

router.post(
  "/contacts/:id/attachments",
  requireContact,
  upload.single("attachment"),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    if (!req.file) throw new AppError("No file", 400);

    const result = await interactionService
      .handleAttachment(scopeOf(req), String(req.params.id), req.file)
      .catch(async (error) => {
        await fs.promises
          .unlink(req.file!.path)
          .catch((cleanupError) =>
            log.warn(
              "API",
              `Upload cleanup failed: ${getErrorMessage(cleanupError)}`,
            ),
          );
        throw error;
      });
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
      scopeOf(req),
      String(req.params.id),
      req.body,
    );
    if (!result) throw new NotFoundError("Interaction");

    log.info("API", `[${rid}] PATCH interaction → ${String(req.params.id)}`);
    res.json(result);
  }),
);

router.delete(
  "/interactions/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const success = interactionService.deleteInteraction(
      scopeOf(req),
      String(req.params.id),
    );
    if (!success) throw new NotFoundError("Interaction");

    log.info("API", `[${rid}] DELETE interaction → ${String(req.params.id)}`);
    res.json({ success: true });
  }),
);

router.get(
  "/contacts/:id/relationships",
  requireContact,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const rawLimit = req.query.limit;
    if (
      rawLimit !== undefined &&
      (typeof rawLimit !== "string" ||
        !/^\d+$/.test(rawLimit) ||
        Number(rawLimit) < 1 ||
        Number(rawLimit) > 200)
    )
      throw new AppError("limit must be an integer from 1 to 200", 400);
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);

    const rows = interactionService.getRelationships(
      scopeOf(req),
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
