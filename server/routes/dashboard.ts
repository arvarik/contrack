import { Router } from "express";
import { log } from "../utils/logger.ts";
import { dashboardService } from "../services/dashboardService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

router.get("/dashboard", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  
  const payload = dashboardService.getDashboardPayload();
  log.debug("API", `[${rid}] GET /api/dashboard`);
  
  res.json(payload);
}));

router.get("/dashboard/insight", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  
  const insight = await dashboardService.getInsight();
  log.debug("API", `[${rid}] GET /api/dashboard/insight`);
  
  res.json(insight); // returns null correctly if key missing or not enough data
}));

export const dashboardRouter = router;
