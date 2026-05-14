/**
 * Action Items Router — REST API for follow-up task management.
 *
 * Endpoints:
 *   GET    /api/action-items          — All pending items (global dashboard)
 *   GET    /api/action-items/count    — Urgent count for sidebar badge
 *   GET    /api/contacts/:id/action-items — Per-contact items
 *   POST   /api/contacts/:id/action-items — Create new action item
 *   PATCH  /api/action-items/:id      — Snooze/edit
 *   PATCH  /api/action-items/:id/complete — Mark complete
 *   DELETE /api/action-items/:id      — Delete
 *
 * @module server/routes/actionItems
 */
import { Router } from "express";
import { log } from "../utils/logger.ts";
import { actionItemService } from "../services/actionItemService.ts";
import {
  validateBody,
  actionItemCreateSchema,
  actionItemUpdateSchema,
} from "../utils/validators.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

// ─── Global endpoints ────────────────────────────────────────────────────────

router.get(
  "/action-items",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const items = actionItemService.getAllPending();
    log.debug("API", `[${rid}] GET /api/action-items → ${items.length}`);
    res.json(items);
  }),
);

router.get(
  "/action-items/completed",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const items = actionItemService.getRecentlyCompleted();
    log.debug(
      "API",
      `[${rid}] GET /api/action-items/completed → ${items.length}`,
    );
    res.json(items);
  }),
);

router.get(
  "/action-items/count",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const count = actionItemService.getUrgentCount();
    log.debug("API", `[${rid}] GET /api/action-items/count → ${count}`);
    res.json({ count });
  }),
);

// ─── Item-level endpoints ────────────────────────────────────────────────────

router.patch(
  "/action-items/:id",
  validateBody(actionItemUpdateSchema),
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const updated = actionItemService.update(String(req.params.id), req.body);
    if (!updated) throw new AppError("Action item not found", 404);
    log.info(
      "API",
      `[${rid}] PATCH /api/action-items/${String(req.params.id)}`,
    );
    res.json(updated);
  }),
);

router.patch(
  "/action-items/:id/complete",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const completed = actionItemService.complete(String(req.params.id));
    if (!completed) throw new AppError("Action item not found", 404);
    log.info(
      "API",
      `[${rid}] PATCH /api/action-items/${String(req.params.id)}/complete`,
    );
    res.json(completed);
  }),
);

router.delete(
  "/action-items/:id",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const success = actionItemService.delete(String(req.params.id));
    if (!success) throw new AppError("Action item not found", 404);
    log.info(
      "API",
      `[${rid}] DELETE /api/action-items/${String(req.params.id)}`,
    );
    res.json({ success: true });
  }),
);

// ─── Per-contact endpoints ───────────────────────────────────────────────────

router.get(
  "/contacts/:id/action-items",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const items = actionItemService.getByContactId(String(req.params.id));
    log.debug(
      "API",
      `[${rid}] GET /api/contacts/${String(req.params.id)}/action-items → ${items.length}`,
    );
    res.json(items);
  }),
);

router.post(
  "/contacts/:id/action-items",
  validateBody(actionItemCreateSchema),
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const { title, dueAt } = req.body;
    const item = actionItemService.create(String(req.params.id), title, dueAt);
    log.info(
      "API",
      `[${rid}] POST /api/contacts/${String(req.params.id)}/action-items → "${title}"`,
    );
    res.status(201).json(item);
  }),
);

export const actionItemsRouter = router;
