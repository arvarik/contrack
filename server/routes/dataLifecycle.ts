// =============================================================================
// Routes — Data Lifecycle: trash (undoable deletes), backups, full export
// =============================================================================
// Mounted in server/app.ts at /api.
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { log } from "../utils/logger.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validateBody } from "../utils/validators.ts";
import { contactService } from "../services/contactService.ts";
import { listBackups, runBackup } from "../services/backupService.ts";
import {
  buildFullExport,
  buildContactsCsv,
} from "../services/exportService.ts";

const router = Router();

// ─── Trash ───────────────────────────────────────────────────────────────────

router.get(
  "/trash",
  asyncHandler(async (_req, res) => {
    res.json({ items: contactService.listTrash() });
  }),
);

router.post(
  "/trash/:id/restore",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const restored = contactService.restoreContact(String(req.params.id));
    if (!restored) {
      throw new AppError("Trashed contact not found", 404, {
        code: "NOT_FOUND",
      });
    }
    log.info("API", `[${rid}] POST /api/trash/${req.params.id}/restore`);
    res.json(restored);
  }),
);

/**
 * Restore many at once — the undo path for a bulk delete.
 *
 * Without this, undoing a 200-contact delete meant 200 round trips, which is
 * slow enough that the user watches their contacts trickle back one by one
 * and cannot tell whether it worked.
 */
router.post(
  "/trash/bulk-restore",
  validateBody(z.object({ ids: z.array(z.string().min(1)).min(1) })),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    let count = 0;
    for (const id of req.body.ids as string[]) {
      // Skip anything already restored or purged rather than failing the whole
      // batch: undo has to be forgiving, or it is not undo.
      if (contactService.restoreContact(id)) count += 1;
    }
    log.info(
      "API",
      `[${rid}] POST /api/trash/bulk-restore → ${count} restored`,
    );
    res.json({ success: true, count });
  }),
);

router.delete(
  "/trash/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const purged = contactService.purgeTrashedContact(String(req.params.id));
    if (!purged) {
      throw new AppError("Trashed contact not found", 404, {
        code: "NOT_FOUND",
      });
    }
    log.info("API", `[${rid}] DELETE /api/trash/${req.params.id} (purged)`);
    res.json({ success: true });
  }),
);

// ─── Backups ─────────────────────────────────────────────────────────────────

router.get(
  "/backups",
  asyncHandler(async (_req, res) => {
    res.json({ backups: listBackups() });
  }),
);

router.post(
  "/backups",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const backup = await runBackup();
    log.info("API", `[${rid}] POST /api/backups → ${backup.filename}`);
    res.status(201).json(backup);
  }),
);

// ─── Export ──────────────────────────────────────────────────────────────────

router.get(
  "/export/json",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const payload = buildFullExport();
    const stamp = payload.exportedAt.slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrack-export-${stamp}.json"`,
    );
    log.info(
      "API",
      `[${rid}] GET /api/export/json → ${payload.contacts.length} contacts`,
    );
    res.send(JSON.stringify(payload, null, 2));
  }),
);

router.get(
  "/export/csv",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const csv = buildContactsCsv();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrack-contacts-${stamp}.csv"`,
    );
    log.info("API", `[${rid}] GET /api/export/csv`);
    res.send(csv);
  }),
);

export const dataLifecycleRouter = router;
