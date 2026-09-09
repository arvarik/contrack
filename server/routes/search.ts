import { sqlite } from "../db.ts";
import { ACTIVE_CONTACT_SQL } from "../services/search/ftsIndex.ts";
import { withTimeout } from "../ai/resilience.ts";
import type { FacetFilter } from "../../shared/searchFacets.ts";
import { z } from "zod";
import { ValidationError } from "../utils/AppError.ts";
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
    const rid = req.requestId;
    const q = req.query.q;
    if (q !== undefined && typeof q !== "string")
      throw new AppError("q must be a string", 400);

    if (!q) return res.json([]);
    if (q.length > 500) throw new AppError("q must be ≤ 500 characters", 400);

    let filters: FacetFilter[] = [];
    if (req.query.filters !== undefined) {
      if (
        typeof req.query.filters !== "string" ||
        req.query.filters.length > 4000
      )
        throw new ValidationError("Invalid search filters");
      try {
        filters = z
          .array(
            z.object({
              field: z.enum([
                "role",
                "company",
                "location",
                "industry",
                "tag",
                "score",
                "updated",
              ]),
              value: z.string().trim().min(1).max(100),
              operator: z.enum([">", "<"]).optional(),
            }),
          )
          .max(8)
          .parse(JSON.parse(req.query.filters));
      } catch {
        throw new ValidationError("Invalid search filters");
      }
    }
    const results = searchService.searchFts(q, filters);
    log.debug(
      "API",
      `[${rid}] GET /api/search?q="${q.replace(/["']/g, "")}" → ${results.length}`,
    );
    res.json(results);
  }),
);

/** Stream local candidates before AI refinement, followed by one terminal result. */
router.post(
  "/semantic",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
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
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      // Create an AbortController bound to request closure
      const controller = new AbortController();
      const onClose = () => {
        log.info(
          "API",
          `[${rid}] Client disconnected mid-search stream. Aborting AI operations.`,
        );
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", onClose);

      try {
        await searchService.semanticSearchStream(
          query,
          rid,
          res,
          controller.signal,
        );
      } finally {
        res.off("close", onClose);
      }
    } else {
      // Single-response mode (backward compatible)
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", onClose);
      try {
        const result = await searchService.semanticSearch(
          query,
          rid,
          controller.signal,
        );
        if (!res.destroyed) res.json(result);
      } finally {
        res.off("close", onClose);
      }
    }
  }),
);

/**
 * POST /api/search/synthesize — Executive Brief (Feature 6)
 *
 * Accepts a query and the already-returned search results, streams an
 * NDJSON executive summary via the AI service.
 *
 * Body: { query: string, contactIds: string[] }. Facts come from the database.
 *
 * Streams:
 *   { phase: "start" }
 *   { phase: "complete", text: "..." }
 */
router.post(
  "/synthesize",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const { query, contactIds } = z
      .object({
        query: z.string().trim().min(1).max(500),
        contactIds: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
      })
      .parse(req.body);
    const ids = [...new Set(contactIds)];
    const contacts = sqlite
      .prepare(
        `SELECT c.id,c.name,c.role,c.company,c.location FROM contacts c WHERE ${ACTIVE_CONTACT_SQL} AND c.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(ids)) as {
      id: string;
      name: string;
      role?: string;
      company?: string;
      location?: string;
    }[];
    if (contacts.length !== ids.length)
      throw new AppError(
        "Some contacts are no longer available. Search again.",
        409,
      );
    const source = JSON.stringify(contacts);
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);

    // Stream the response
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send start signal
    res.write(JSON.stringify({ phase: "start" }) + "\n");

    try {
      const text = await withTimeout(
        (signal) => synthesizeSearchResults(query, contacts, null, signal),
        10_000,
        controller.signal,
      );
      const current = sqlite
        .prepare(
          `SELECT c.id,c.name,c.role,c.company,c.location FROM contacts c WHERE ${ACTIVE_CONTACT_SQL} AND c.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(ids));
      if (JSON.stringify(current) !== source)
        throw new Error("Contacts changed. Generate a new summary.");
      if (!res.destroyed)
        res.write(JSON.stringify({ phase: "complete", text }) + "\n");
    } catch (err: unknown) {
      log.error("API", `[${rid}] Synthesis failed: ${getErrorMessage(err)}`);
      if (!res.destroyed)
        res.write(
          JSON.stringify({
            phase: "error",
            error: "Could not create a summary. Please try again.",
          }) + "\n",
        );
    }

    res.off("close", onClose);
    if (!res.destroyed) res.end();
  }),
);

export const searchRouter = router;
