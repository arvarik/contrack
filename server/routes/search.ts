import { sqlite } from "../db.ts";
import { ACTIVE_CONTACT_SQL } from "../services/search/ftsIndex.ts";
import { withTimeout } from "../ai/resilience.ts";
import {
  facetFiltersSchema,
  type FacetFilter,
} from "../../shared/searchFacets.ts";
import { z } from "zod";
import { ValidationError } from "../utils/AppError.ts";
import { Router } from "express";
import { log } from "../utils/logger.ts";
import { searchService } from "../services/searchService.ts";
import { searchInteractions } from "../services/interactionSearchService.ts";
import { parseInteractionSearchQuery } from "../utils/validators.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { startStream } from "../utils/stream.ts";
import { synthesizeSearchResults } from "../ai/index.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { resolveEmbeddings } from "../ai/embeddings.ts";
import { currentEmbedder } from "../ai/embedder.ts";
import {
  getSearchCoverage,
  enqueueMissingContactsForOwner,
  drainIndexQueue,
} from "../services/search/indexQueue.ts";
import { searchHistoryService } from "../services/searchHistoryService.ts";
import { starterQuestions } from "../services/search/starterQuestions.ts";
import type { StarterQuestionsResponse } from "../../shared/starterQuestions.ts";
import { aiAllowedFor } from "../middleware/aiAllowed.ts";
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

    // Every palette facet, `near:` with its resolved point included. The
    // facets run in SQL inside the keyword search.
    let filters: FacetFilter[] = [];
    if (req.query.filters !== undefined) {
      if (
        typeof req.query.filters !== "string" ||
        req.query.filters.length > 4000
      )
        throw new ValidationError("Invalid search filters");
      try {
        filters = facetFiltersSchema.parse(JSON.parse(req.query.filters));
      } catch {
        throw new ValidationError("Invalid search filters");
      }
    }
    const results = searchService.searchFts(scope, q, filters);
    log.debug("API", `[${rid}] GET /api/search → ${results.length}`);
    res.json(results);
  }),
);

/**
 * GET /api/search/interactions: notes, with the date and an excerpt. "Who
 * discussed hiring last month?" gives the notes that mention hiring, dated last
 * month in the caller's zone, each with its person and the passage that
 * matched. Local FTS5 only, no model. Query parameters: `q`, `from`, `to`,
 * `type`, `contactId`, `sort`, `mode`, `limit`, `offset` and `tz` (see
 * docs/api-reference.md).
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
      `[${rid}] GET /api/search/interactions ` +
        `mode=${result.query.mode} range=${result.query.range ? result.query.range.source : "none"} → ${result.hits.length} of ${result.total}`,
    );
    res.json(result);
  }),
);

/**
 * Stream local candidates before AI refinement, followed by one terminal
 * result. With AI off for the caller, the local results are the answer.
 *
 * Body: `{ query: string, filters?: FacetFilter[] }`. The palette sends its
 * pills as `filters`. Facets typed into the query are read from it too.
 */
router.post(
  "/semantic",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    // Read once, before either branch. The NDJSON branch writes from inside a
    // stream, and rule 6 keeps the owner an argument rather than something
    // read back out of the async context after the first await.
    const scope = scopeOf(req);
    const { query, filters: rawFilters } = req.body as {
      query?: string;
      filters?: unknown;
    };

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new AppError("query is required", 400);
    }
    if (query.trim().length > 500) {
      throw new AppError("query must be ≤ 500 characters", 400);
    }
    const parsedFilters =
      rawFilters === undefined
        ? { success: true as const, data: [] }
        : facetFiltersSchema.safeParse(rawFilters);
    if (!parsedFilters.success)
      throw new ValidationError("Invalid search filters");
    const options = {
      aiAllowed: aiAllowedFor(req),
      filters: parsedFilters.data,
    };

    const accept = req.headers.accept || "";
    // Only stream when explicitly requested — Accept: */* (the default for
    // curl, Postman, fetch) should fall back to single-response JSON.
    const wantsStream = accept.includes("application/x-ndjson");

    if (wantsStream) {
      // Two-phase streaming response
      startStream(res, "application/x-ndjson");

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
          options,
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
          options,
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
 * POST /api/search/synthesize: the executive brief over results already
 * returned, streamed as NDJSON. Body: { query: string, contactIds: string[] };
 * the facts come from the database.
 *
 * Streams:
 *   { phase: "start" }
 *   { phase: "delta", text: "..." }   the next piece, zero or more times
 *   { phase: "complete", text: "..." } the whole sanitized brief
 *   { phase: "error", error: "..." }   instead of complete. Drop the pieces.
 * A cached brief sends no pieces.
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
    // The facts the brief may use. Industry is one of them: a question such
    // as "who works in fintech" is answered from it, and without it the
    // model said nobody did. Read twice, before and after the model runs.
    const readContacts = () =>
      sqlite
        .prepare(
          `SELECT c.id,c.name,c.role,c.company,c.industry,c.location FROM contacts c
             WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL} AND c.id IN (SELECT value FROM json_each(?))`,
        )
        .all(scope.ownerId, JSON.stringify(ids)) as {
        id: string;
        name: string;
        role?: string;
        company?: string;
        industry?: string;
        location?: string;
      }[];
    // TODO(v2.1): Build richer summaries from server-validated passage references tied to each contact.
    // Check each claim against that contact and source revision before streaming it.
    const contacts = readContacts();
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
    startStream(res, "application/x-ndjson");

    // Send start signal
    res.write(JSON.stringify({ phase: "start" }) + "\n");

    // Once the terminal chunk is written, a late piece from an abandoned
    // stream must not follow it.
    let settled = false;
    const write = (chunk: object) => {
      if (!settled && !res.destroyed && !res.writableEnded)
        res.write(JSON.stringify(chunk) + "\n");
    };
    try {
      const text = await withTimeout(
        (signal) =>
          synthesizeSearchResults(
            scope,
            query,
            contacts,
            null,
            signal,
            (piece) => write({ phase: "delta", text: piece }),
          ),
        10_000,
        controller.signal,
      );
      if (JSON.stringify(readContacts()) !== source)
        throw new Error("Contacts changed. Generate a new summary.");
      write({ phase: "complete", text });
      settled = true;
    } catch (err: unknown) {
      log.error("API", `[${rid}] Synthesis failed: ${getErrorMessage(err)}`);
      write({
        phase: "error",
        error: "Could not create a summary. Please try again.",
      });
      settled = true;
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
 * GET /api/search/starters: the caller's pool of starter questions, built from
 * their own contacts and never longer than their number of contacts. The Ask
 * page shows six at random under "Try asking".
 */
router.get(
  "/starters",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const body: StarterQuestionsResponse = {
      questions: starterQuestions(scope),
    };
    res.json(body);
  }),
);

/**
 * POST /api/search/refresh-index: index the missing contacts, or all of them. A
 * paid provider needs `{ allowProvider: true }`, so nobody is charged without
 * saying so, and the route answers 403 AI_OFF_FOR_ACCOUNT while the caller has
 * AI off.
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

    // A hosted model sends each contact to the provider, which the account's
    // own AI switch forbids. A local model still indexes, with AI off.
    const { local } = currentEmbedder();
    if (!local && !aiAllowedFor(req)) {
      throw new AppError("AI is off for this account", 403, {
        code: "AI_OFF_FOR_ACCOUNT",
      });
    }
    if (!local && !allowProvider) {
      const resolved = resolveEmbeddings();
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

// Search History

router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
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
