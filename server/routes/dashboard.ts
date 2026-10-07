import { Router } from "express";
import { log } from "../utils/logger.ts";
import { dashboardService } from "../services/dashboardService.ts";
import { zeroStateService } from "../services/zeroStateService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { abortOnDisconnect, isClientAbort } from "../utils/stream.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { readerTimeZone } from "../utils/validators.ts";

const router = Router();

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const payload = dashboardService.getDashboardPayload(
      scopeOf(req),
      readerTimeZone(req.query.tz),
    );
    log.debug("API", `[${rid}] GET /api/dashboard`);

    res.json(payload);
  }),
);

router.get(
  "/dashboard/activity",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const payload = dashboardService.getActivity(
      scopeOf(req),
      readerTimeZone(req.query.tz),
    );
    log.debug("API", `[${rid}] GET /api/dashboard/activity`);

    res.json(payload);
  }),
);

router.get(
  "/dashboard/insight",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const client = abortOnDisconnect(res);

    try {
      const insight = await dashboardService.getInsight(
        scopeOf(req),
        client.signal,
      );
      log.debug("API", `[${rid}] GET /api/dashboard/insight`);

      if (!res.destroyed) res.json(insight);
    } catch (err: unknown) {
      if (isClientAbort(err, client.signal)) return;
      throw err;
    } finally {
      client.release();
    }
  }),
);

/**
 * GET /api/command-palette/zero-state: the palette's empty state (follow-ups
 * due, catch-ups, ghost alerts), from SQLite alone, under 10 ms.
 */
router.get(
  "/command-palette/zero-state",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const payload = zeroStateService.getPayload(
      scopeOf(req),
      readerTimeZone(req.query.tz),
    );
    log.debug(
      "API",
      `[${rid}] GET /api/command-palette/zero-state → ${payload.insights.length} insights`,
    );

    res.json(payload);
  }),
);

export const dashboardRouter = router;
