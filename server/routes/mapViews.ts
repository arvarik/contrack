import { Router } from "express";
import { mapViewService } from "../services/mapViewService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { log } from "../utils/logger.ts";

export const mapViewsRouter = Router();

mapViewsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const views = mapViewService.listMapViews(scopeOf(req));
    log.debug("API", `[${rid}] GET /api/map/views → ${views.length}`);
    res.json({ views });
  }),
);

mapViewsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const view = mapViewService.createMapView(scopeOf(req), req.body);
    log.info(
      "API",
      `[${rid}] POST /api/map/views → "${view.name}" (${view.id})`,
    );
    res.status(201).json(view);
  }),
);

mapViewsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const view = mapViewService.updateMapView(
      scopeOf(req),
      String(req.params.id),
      req.body,
    );
    log.info(
      "API",
      `[${rid}] PATCH /api/map/views/${String(req.params.id)} → "${view.name}"`,
    );
    res.json(view);
  }),
);

mapViewsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const result = mapViewService.deleteMapView(
      scopeOf(req),
      String(req.params.id),
    );
    log.info(
      "API",
      `[${rid}] DELETE /api/map/views/${String(req.params.id)} → success`,
    );
    res.json(result);
  }),
);
