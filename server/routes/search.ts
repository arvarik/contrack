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
  if (q.length > 500) throw new AppError("q must be ≤ 500 characters", 400);

  const results = searchService.searchFts(q);
  log.debug("API", `[${rid}] GET /api/search?q="${q.replace(/["']/g, "")}" → ${results.length}`);
  res.json(results);
}));

/**
 * POST /api/search/semantic — Ask Contrack v3 two-phase streaming search.
 *
 * Streams NDJSON (newline-delimited JSON):
 *   Phase 1: { phase: "instant", matches: [...] }   — sent in <15ms
 *   Phase 2: { phase: "enriched", matches: [...] }  — sent ~500ms later (optional)
 *   Final:   { phase: "complete", matches: [...] }   — for cache hits + short-circuits
 *
 * If the client sends `Accept: application/json`, falls back to the
 * non-streaming single-response mode for backward compatibility.
 */
router.post("/semantic", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { query } = req.body as { query?: string };

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new AppError("query is required", 400);
  }
  if (query.trim().length > 500) {
    throw new AppError("query must be ≤ 500 characters", 400);
  }

  const accept = req.headers.accept || "";
  // Only stream when explicitly requested — Accept: */* (the default for
  // curl, Postman, fetch) should fall back to single-response JSON.
  const wantsStream = accept.includes("application/x-ndjson");

  if (wantsStream) {
    // Two-phase streaming response
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    await searchService.semanticSearchStream(query, rid, res);
  } else {
    // Single-response mode (backward compatible)
    const result = await searchService.semanticSearch(query, rid);
    res.json(result);
  }
}));

export const searchRouter = router;
