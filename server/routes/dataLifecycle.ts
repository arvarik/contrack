import { idsSchema } from "../../shared/contracts/common.ts";
// Data lifecycle routes: trash (undoable deletes), backups and full export.

import { Router } from "express";
import { z } from "zod";
import { log } from "../utils/logger.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validateBody } from "../utils/validators.ts";
import { contactService } from "../services/contactService.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { auditService } from "../services/auditService.ts";
import { listBackups, runBackup } from "../services/backupService.ts";
import { trashRetentionDays } from "../services/lifecycleSettings.ts";
import {
  buildFullExport,
  buildContactsCsv,
  buildContactsVcf,
  exportFileSlug,
} from "../services/exportService.ts";

const router = Router();

// Trash

// The trash routes are scoped through `contactService` and enforced by isolation tests.
router.get(
  "/trash",
  asyncHandler(async (req, res) => {
    res.json({
      items: contactService.listTrash(scopeOf(req)),
      retentionDays: trashRetentionDays().value,
    });
  }),
);

router.post(
  "/trash/:id/restore",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const restored = contactService.restoreContact(
      scopeOf(req),
      String(req.params.id),
    );
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
 * Restore many at once, the undo of a bulk delete, so undoing 200 deletes is
 * one round trip instead of 200.
 */
router.post(
  "/trash/bulk-restore",
  validateBody(z.object({ ids: idsSchema })),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    let count = 0;
    for (const id of req.body.ids as string[]) {
      // Skip anything already restored or purged rather than failing the whole
      // batch: undo has to be forgiving, or it is not undo.
      if (contactService.restoreContact(scopeOf(req), id)) count += 1;
    }
    log.info(
      "API",
      `[${rid}] POST /api/trash/bulk-restore → ${count} restored`,
    );
    res.json({ success: true, count });
  }),
);

router.delete(
  "/trash",
  asyncHandler(async (req, res) => {
    const count = contactService.emptyTrash(scopeOf(req));
    log.info("API", `[${req.requestId}] DELETE /api/trash → ${count} purged`);
    res.json({ count });
  }),
);

router.delete(
  "/trash/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const purged = contactService.purgeTrashedContact(
      scopeOf(req),
      String(req.params.id),
    );
    if (!purged) {
      throw new AppError("Trashed contact not found", 404, {
        code: "NOT_FOUND",
      });
    }
    log.info("API", `[${rid}] DELETE /api/trash/${req.params.id} (purged)`);
    res.json({ success: true });
  }),
);

// Backups

// A backup is a copy of the whole database, so it holds every account's rows,
// and both routes are admin only.
router.get(
  "/backups",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ backups: listBackups() });
  }),
);

router.post(
  "/backups",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const backup = await runBackup();
    auditService.record({
      actorUserId: req.principal?.user.id ?? null,
      action: "backup.created",
      targetType: "backup",
      targetId: backup.filename,
      // `verified` goes in the audit row, because a snapshot that failed its
      // check is worth finding later, and the sidecar of a rotated-out file is
      // gone.
      details: {
        filename: backup.filename,
        verified: backup.verification?.ok ?? false,
        ...(backup.verification?.problem
          ? { problem: backup.verification.problem }
          : {}),
      },
      ip: req.ip ?? null,
    });
    log.info(
      "API",
      `[${rid}] POST /api/backups → ${backup.filename} (${backup.verification?.ok ? "verified" : "NOT verified"})`,
    );
    res.status(201).json(backup);
  }),
);

// Export

router.get(
  "/export/json",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const payload = buildFullExport(scopeOf(req));
    const stamp = payload.exportedAt.slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrack-export-${exportFileSlug(req.principal?.user.username)}-${stamp}.json"`,
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
    const csv = buildContactsCsv(scopeOf(req));
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrack-contacts-${exportFileSlug(req.principal?.user.username)}-${stamp}.csv"`,
    );
    log.info("API", `[${rid}] GET /api/export/csv`);
    res.send(csv);
  }),
);

router.get(
  "/export/vcard",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const vcf = buildContactsVcf(scopeOf(req));
    const stamp = new Date().toISOString().slice(0, 10);
    // `text/vcard` is the registered type. Every desktop and mobile address
    // book opens it from a download; `text/plain` shows the file instead.
    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrack-contacts-${exportFileSlug(req.principal?.user.username)}-${stamp}.vcf"`,
    );
    log.info("API", `[${rid}] GET /api/export/vcard`);
    res.send(vcf);
  }),
);

export const dataLifecycleRouter = router;
