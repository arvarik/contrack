import { Router } from "express";
import { log } from "../utils/logger.ts";
import { dashboardService } from "../services/dashboardService.ts";
import { zeroStateService } from "../services/zeroStateService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { isValidTimeZone } from "../../shared/contracts/common.ts";

const router = Router();

/**
 * The reader's IANA zone, from `?tz=`, when Intl knows it. Pulse sends it,
 * as note search does. Without one the server's zone stands.
 */
function readerTimeZone(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length <= 64 && isValidTimeZone(raw)
    ? raw
    : undefined;
}

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

    const payload = dashboardService.getActivity(scopeOf(req));
    log.debug("API", `[${rid}] GET /api/dashboard/activity`);

    res.json(payload);
  }),
);

router.get(
  "/dashboard/insight",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);

    try {
      const insight = await dashboardService.getInsight(
        scopeOf(req),
        controller.signal,
      );
      log.debug("API", `[${rid}] GET /api/dashboard/insight`);

      if (!res.destroyed) res.json(insight);
    } catch (err: unknown) {
      if (
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      throw err;
    } finally {
      res.off("close", onClose);
    }
  }),
);

/**
 * GET /api/command-palette/zero-state
 *
 * Returns deterministic CRM intelligence signals for the Cmd+K zero-state:
 * action items due, catch-ups, ghost alerts. Pure SQLite — sub-10ms.
 */
router.get(
  "/command-palette/zero-state",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const payload = zeroStateService.getPayload(scopeOf(req));
    log.debug(
      "API",
      `[${rid}] GET /api/command-palette/zero-state → ${payload.insights.length} insights`,
    );

    res.json(payload);
  }),
);

export const dashboardRouter = router;
