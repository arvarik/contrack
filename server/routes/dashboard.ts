import { Router } from "express";
import { log } from "../utils/logger.ts";
import { dashboardService } from "../services/dashboardService.ts";
import { zeroStateService } from "../services/zeroStateService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const payload = dashboardService.getDashboardPayload();
    log.debug("API", `[${rid}] GET /api/dashboard`);

    res.json(payload);
  }),
);

router.get(
  "/dashboard/insight",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const insight = await dashboardService.getInsight();
    log.debug("API", `[${rid}] GET /api/dashboard/insight`);

    res.json(insight); // returns null correctly if key missing or not enough data
  }),
);

/**
 * GET /api/command-palette/zero-state
 *
 * Returns deterministic CRM intelligence signals for the Cmd+K zero-state:
 * action items due, at-risk contacts, ghost alerts. Pure SQLite — sub-10ms.
 */
router.get(
  "/command-palette/zero-state",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const payload = zeroStateService.getPayload();
    log.debug(
      "API",
      `[${rid}] GET /api/command-palette/zero-state → ${payload.insights.length} insights`,
    );

    res.json(payload);
  }),
);

export const dashboardRouter = router;
