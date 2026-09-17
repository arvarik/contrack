import { sqlite } from "../db.ts";
import { ACTIVE_CONTACT_SQL } from "../services/search/ftsIndex.ts";
import { withTimeout } from "../ai/resilience.ts";
import type { FacetFilter } from "../../shared/searchFacets.ts";
import { z } from "zod";
import { ValidationError } from "../utils/AppError.ts";
import { Router } from "express";
import { log } from "../utils/logger.ts";
import { searchService } from "../services/searchService.ts";
import { searchInteractions } from "../services/interactionSearchService.ts";
import { parseInteractionSearchQuery } from "../utils/validators.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { synthesizeSearchResults } from "../ai/index.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { resolveEmbeddings } from "../ai/embeddings.ts";
import {
  getSearchCoverage,
  enqueueMissingContactsForOwner,
  drainIndexQueue,
} from "../services/search/indexQueue.ts";
import { searchHistoryService } from "../services/searchHistoryService.ts";
import {
  recordHistorySchema,
  patchHistorySchema,
  listHistoryQuerySchema,
  historyModeSchema,
} from "../../shared/searchHistory.ts";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const scope = scopeOf(req);
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
    const results = searchService.searchFts(scope, q, filters);
    log.debug(
      "API",
      `[${rid}] GET /api/search?q="${q.replace(/["']/g, "")}" → ${results.length}`,
    );
    res.json(results);
  }),
);

/**
 * GET /api/search/interactions — notes, with the date and an excerpt.
 *
 * "Who discussed hiring last month?" → the notes that mention hiring, dated
 * last month in the caller's zone, each with the person it is about and the
 * passage that matched. Local FTS5 only; no model is called. Query
 * parameters: `q`, `from`, `to`, `type`, `contactId`, `sort`, `mode`,
 * `limit`, `offset` and `tz`. See docs/api-reference.md.
 */
router.get(
  "/interactions",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const scope = scopeOf(req);
    const params = parseInteractionSearchQuery(req.query);
    const result = searchInteractions(scope, params);
    log.debug(
      "API",
      `[${rid}] GET /api/search/interactions q="${(params.q ?? "").replace(/["']/g, "")}" ` +
        `mode=${result.query.mode} range=${result.query.range ? result.query.range.source : "none"} → ${result.hits.length} of ${result.total}`,
    );
    res.json(result);
  }),
);

/** Stream local candidates before AI refinement, followed by one terminal result. */
router.post(
  "/semantic",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    // Read once, before either branch. The NDJSON branch writes from inside a
    // stream, and rule 6 keeps the owner an argument rather than something
    // read back out of the async context after the first await.
    const scope = scopeOf(req);
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
          scope,
          query,
          rid,
          res,
          controller.signal,
        );
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
    } else {
      // Single-response mode (backward compatible)
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", onClose);
      try {
        const result = await searchService.semanticSearch(
          scope,
          query,
          rid,
          controller.signal,
        );
        if (!res.destroyed) res.json(result);
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
    // Captured before the stream opens, for the same reason as /semantic.
    const scope = scopeOf(req);
    const { query, contactIds } = z
      .object({
        query: z.string().trim().min(1).max(500),
        contactIds: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
      })
      .parse(req.body);
    const ids = [...new Set(contactIds)];
    const contacts = sqlite
      .prepare(
        `SELECT c.id,c.name,c.role,c.company,c.location FROM contacts c
           WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL} AND c.id IN (SELECT value FROM json_each(?))`,
      )
      .all(scope.ownerId, JSON.stringify(ids)) as {
      id: string;
      name: string;
      role?: string;
      company?: string;
      location?: string;
    }[];
    // A contact id the caller does not own is missing as far as this owner is
    // concerned, so it takes the same 409 a deleted id has always taken. The
    // two answers are identical, which is what rule 4 asks for.
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
        (signal) =>
          synthesizeSearchResults(scope, query, contacts, null, signal),
        10_000,
        controller.signal,
      );
      const current = sqlite
        .prepare(
          `SELECT c.id,c.name,c.role,c.company,c.location FROM contacts c
             WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL} AND c.id IN (SELECT value FROM json_each(?))`,
        )
        .all(scope.ownerId, JSON.stringify(ids));
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

/**
 * GET /api/search/coverage — Report semantic search indexing coverage for the caller's account.
 */
router.get(
  "/coverage",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const coverage = getSearchCoverage(scope);
    res.json(coverage);
  }),
);

/**
 * POST /api/search/refresh-index — Explicitly trigger indexing for missing or all contacts.
 *
 * For paid providers, requires explicit confirmation ({ allowProvider: true }) to prevent
 * unapproved API charges.
 */
router.post(
  "/refresh-index",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const { allowProvider, forceAll } = z
      .object({
        allowProvider: z.boolean().optional(),
        forceAll: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const resolved = resolveEmbeddings();
    if (resolved.kind === "provider" && !allowProvider) {
      const coverage = getSearchCoverage(scope);
      return res.status(400).json({
        error: "Paid provider refreshes must be explicitly confirmed.",
        requiresExplicitConfirmation: true,
        provider: resolved.providerId,
        model: resolved.model,
        missingCount: coverage.missing + coverage.pending,
      });
    }

    const queued = enqueueMissingContactsForOwner(
      scope.ownerId,
      forceAll ?? false,
    );
    void drainIndexQueue({ allowProvider: allowProvider === true });

    res.json({
      ok: true,
      queued,
      message:
        queued > 0
          ? `Queued ${queued} contact(s) for indexing`
          : "All contacts already indexed",
    });
  }),
);

// =============================================================================
// Search History
// =============================================================================

router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    searchHistoryService.backfillFromPreferences(scope.ownerId);
    const query = listHistoryQuerySchema.parse(req.query);
    const result = searchHistoryService.list(scope.ownerId, query);
    res.json(result);
  }),
);

router.post(
  "/history",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const body = recordHistorySchema.parse(req.body);
    const entry = searchHistoryService.record(scope.ownerId, body);
    res.json({ entry });
  }),
);

router.delete(
  "/history",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const modeQuery = req.query.mode;
    const mode =
      modeQuery !== undefined ? historyModeSchema.parse(modeQuery) : undefined;
    const result = searchHistoryService.clear(scope.ownerId, mode);
    res.json(result);
  }),
);

router.patch(
  "/history/:id",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const body = patchHistorySchema.parse(req.body);
    const entry = searchHistoryService.setPinned(
      scope.ownerId,
      String(req.params.id),
      body.pinned,
    );
    if (!entry) {
      throw new AppError("Search history entry not found", 404);
    }
    res.json({ entry });
  }),
);

router.delete(
  "/history/:id",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const deleted = searchHistoryService.remove(
      scope.ownerId,
      String(req.params.id),
    );
    if (!deleted) {
      throw new AppError("Search history entry not found", 404);
    }
    res.json({ success: true });
  }),
);

export const searchRouter = router;
