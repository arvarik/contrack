import { requireContact } from "../services/contactGuard.ts";
/**
 * Action Items Router — the REST API for follow-ups. "Follow-ups" in
 * docs/api-reference.md lists every route.
 *
 * @module server/routes/actionItems
 */
import { Router } from "express";
import { log } from "../utils/logger.ts";
import { actionItemService } from "../services/actionItemService.ts";
import { validateBody } from "../utils/validators.ts";
import { actionItemRoutes } from "../../shared/contracts/actionItems.ts";
import { NotFoundError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";

const router = Router();

// ─── Global endpoints ────────────────────────────────────────────────────────

router.get(
  "/action-items",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const items = actionItemService.getAllPending(scopeOf(req));
    log.debug("API", `[${rid}] GET /api/action-items → ${items.length}`);
    res.json(items);
  }),
);

router.get(
  "/action-items/completed",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const items = actionItemService.getRecentlyCompleted(scopeOf(req));
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
    const rid = req.requestId;
    const count = actionItemService.getUrgentCount(scopeOf(req));
    log.debug("API", `[${rid}] GET /api/action-items/count → ${count}`);
    res.json({ count });
  }),
);

router.post(
  "/action-items/bulk",
  validateBody(actionItemRoutes.bulkCreate.body),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const { contactIds, title, dueAt } = req.body;
    const count = actionItemService.createMany(
      scopeOf(req),
      contactIds,
      title,
      dueAt,
    );
    log.info("API", `[${rid}] POST /api/action-items/bulk → ${count} created`);
    res.status(201).json({ count });
  }),
);

// ─── Item-level endpoints ────────────────────────────────────────────────────

router.patch(
  "/action-items/:id",
  validateBody(actionItemRoutes.update.body),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const updated = actionItemService.update(
      scopeOf(req),
      String(req.params.id),
      req.body,
    );
    if (!updated) throw new NotFoundError("Action item");
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
    const rid = req.requestId;
    const completed = actionItemService.complete(
      scopeOf(req),
      String(req.params.id),
    );
    if (!completed) throw new NotFoundError("Action item");
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
    const rid = req.requestId;
    const success = actionItemService.delete(
      scopeOf(req),
      String(req.params.id),
    );
    if (!success) throw new NotFoundError("Action item");
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
  requireContact,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const items = actionItemService.getByContactId(
      scopeOf(req),
      String(req.params.id),
    );
    log.debug(
      "API",
      `[${rid}] GET /api/contacts/${String(req.params.id)}/action-items → ${items.length}`,
    );
    res.json(items);
  }),
);

router.post(
  "/contacts/:id/action-items",
  requireContact,
  validateBody(actionItemRoutes.create.body),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const { title, dueAt } = req.body;
    const item = actionItemService.create(
      scopeOf(req),
      String(req.params.id),
      title,
      dueAt,
    );
    log.info(
      "API",
      `[${rid}] POST /api/contacts/${String(req.params.id)}/action-items → "${title}"`,
    );
    res.status(201).json(item);
  }),
);

export const actionItemsRouter = router;
