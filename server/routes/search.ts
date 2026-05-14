import { Router } from "express";
import { log } from "../utils/logger.ts";
import { searchService } from "../services/searchService.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { synthesizeSearchResults } from "../ai/index.ts";
import { getErrorMessage } from "../utils/helpers.ts";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const q = req.query.q as string;

    if (!q) return res.json([]);
    if (q.length > 500) throw new AppError("q must be ≤ 500 characters", 400);

    const results = searchService.searchFts(q);
    log.debug(
      "API",
      `[${rid}] GET /api/search?q="${q.replace(/["']/g, "")}" → ${results.length}`,
    );
    res.json(results);
  }),
);

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
router.post(
  "/semantic",
  asyncHandler(async (req, res) => {
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
  }),
);

/**
 * POST /api/search/synthesize — Executive Brief (Feature 6)
 *
 * Accepts a query and the already-returned search results, streams an
 * NDJSON executive summary via the AI service.
 *
 * Body: { query: string, contacts: { name, role?, company?, aiReason? }[] }
 *
 * Streams:
 *   { phase: "start" }
 *   { phase: "complete", text: "..." }
 */
router.post(
  "/synthesize",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const { query, contacts } = req.body as {
      query?: string;
      contacts?: {
        name: string;
        role?: string;
        company?: string;
        aiReason?: string;
      }[];
    };

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new AppError("query is required", 400);
    }
    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      throw new AppError(
        "contacts array is required and must be non-empty",
        400,
      );
    }
    if (contacts.length > 30) {
      throw new AppError("contacts array must have ≤ 30 entries", 400);
    }

    log.info(
      "API",
      `[${rid}] POST /api/search/synthesize query="${query.slice(0, 50)}" contacts=${contacts.length}`,
    );

    // Stream the response
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    // Send start signal
    res.write(JSON.stringify({ phase: "start" }) + "\n");

    try {
      const text = await synthesizeSearchResults(query.trim(), contacts);
      res.write(JSON.stringify({ phase: "complete", text }) + "\n");
    } catch (err: unknown) {
      log.error("API", `[${rid}] Synthesis failed: ${getErrorMessage(err)}`);
      res.write(
        JSON.stringify({ phase: "error", error: getErrorMessage(err) }) + "\n",
      );
    }

    res.end();
  }),
);

export const searchRouter = router;
