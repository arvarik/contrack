import { Router } from "express";
import { log } from "../utils/logger.ts";
import { searchService } from "../services/searchService.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const q = req.query.q as string;
  
  if (!q) return res.json([]);
  
  const results = searchService.searchFts(q);
  log.debug("API", `[${rid}] GET /api/search?q="${q.replace(/["']/g, "")}" → ${results.length}`);
  res.json(results);
}));

router.post("/semantic", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { query } = req.body as { query?: string };

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new AppError("query is required", 400);
  }
  if (query.trim().length > 500) {
    throw new AppError("query must be ≤ 500 characters", 400);
  }

  const result = await searchService.semanticSearch(query, rid);
  res.json(result);
}));

export const searchRouter = router;
