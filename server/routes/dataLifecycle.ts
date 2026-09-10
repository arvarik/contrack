import { idsSchema } from "../utils/validators.ts";
// =============================================================================
// Routes — Data Lifecycle: trash (undoable deletes), backups, full export
// =============================================================================
// Mounted in server/app.ts at /api.
// =============================================================================

import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { log } from "../utils/logger.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validateBody } from "../utils/validators.ts";
import { contactService } from "../services/contactService.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { listBackups, runBackup } from "../services/backupService.ts";
import {
  buildFullExport,
  buildContactsCsv,
} from "../services/exportService.ts";

const router = Router();

// ─── Trash ───────────────────────────────────────────────────────────────────

// The trash routes were scoped in 2a through `contactService`. Sub-phase 2g
// added their matrix tests and flipped `isolated`, so the four routes below
// are proven rather than only intended.
router.get(
  "/trash",
  asyncHandler(async (req, res) => {
    res.json({ items: contactService.listTrash(scopeOf(req)) });
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
 * Restore many at once — the undo path for a bulk delete.
 *
 * Without this, undoing a 200-contact delete meant 200 round trips, which is
 * slow enough that the user watches their contacts trickle back one by one
 * and cannot tell whether it worked.
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

/**
 * The account name that goes in the download filename.
 *
 * Two accounts on one instance produce two files a day, and a filename with
 * only a date in it makes the second one overwrite the first in the browser's
 * downloads folder. The username answers which account the file came from.
 *
 * `validateUsername` already restricts what an account name may contain, and
 * this strips anything else anyway: the value lands inside a quoted
 * `Content-Disposition` header, where a stray quote would end the filename.
 */
function exportOwnerSlug(req: Request): string {
  const raw = req.principal?.user.username ?? "";
  const slug = raw.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  return slug || "account";
}

router.get(
  "/export/json",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const payload = buildFullExport(scopeOf(req));
    const stamp = payload.exportedAt.slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="contrack-export-${exportOwnerSlug(req)}-${stamp}.json"`,
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
      `attachment; filename="contrack-contacts-${exportOwnerSlug(req)}-${stamp}.csv"`,
    );
    log.info("API", `[${rid}] GET /api/export/csv`);
    res.send(csv);
  }),
);

export const dataLifecycleRouter = router;
