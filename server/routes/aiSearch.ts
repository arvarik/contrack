// AI Search routes:
// POST /api/ai-search        start a batch
// GET  /api/ai-search/status poll batch status (fallback for SSE)
// GET  /api/ai-search/stream SSE stream of batch updates

import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../utils/validators.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { startStream } from "../utils/stream.ts";
import { jobQueue } from "../services/aiSearch/index.ts";
import { log } from "../utils/logger.ts";
import type { AISearchBatch } from "../services/aiSearch/types.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import {
  chooseResearch,
  researchChoiceSchema,
  STRATEGY_CHOICE,
} from "../services/research/index.ts";
import { getPreferences } from "../services/userPreferencesService.ts";
import { enrichmentContact } from "../services/aiSearch/contactSnapshot.ts";
import { AppError, RateLimitedError } from "../utils/AppError.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { researchDepthSchema } from "../../shared/researchDepth.ts";

export const aiSearchRouter = Router();

// Validation

/**
 * At most 100 contacts a batch. No rate limit of its own: the provider's 429
 * pauses a model in the adapter, one batch runs at a time, and a second
 * start by the same account joins it.
 */
const aiSearchBodySchema = researchChoiceSchema
  .extend({
    contactIds: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Contact IDs must be unique",
      ),
    /**
     * How to search, in the app's words: the research model's own search
     * ("two-pass"), SearXNG alone ("searxng"), or both ("combined"). It names a
     * technique and a web search (`STRATEGY_CHOICE`), so a body names it or
     * `technique` and `webSearch`, not both. With none, the account's web
     * search engine.
     */
    strategy: z.enum(["two-pass", "searxng", "combined"]).optional(),
    /** How thoroughly to research each contact. Default "standard". */
    depth: researchDepthSchema.optional(),
  })
  .refine(
    (body) => !(body.strategy && (body.technique || body.webSearch)),
    "Name a strategy, or a technique and a web search, not both",
  );

// POST /ai-search — Start a new batch

aiSearchRouter.post(
  "/ai-search",
  validateBody(aiSearchBodySchema),
  asyncHandler(async (req, res, next) => {
    const scope = scopeOf(req);
    const { contactIds, strategy, technique, webSearch, depth } =
      req.body as z.infer<typeof aiSearchBodySchema>;

    // A start that names nothing searches the way the account chose.
    const choice = chooseResearch(
      strategy ? STRATEGY_CHOICE[strategy] : { technique, webSearch },
      getPreferences(scope.ownerId).webSearchEngine,
    );

    // The global run lock: another account's batch holds it. This account's
    // own running batch does not refuse; the new contacts join it below.
    const check = jobQueue.canStartBatch(scope);
    if (!check.allowed) {
      // The standard error envelope. `details.yours` is false: somebody else's
      // batch holds the shared provider lock.
      return next(
        new RateLimitedError(check.reason ?? "Please try again shortly.", {
          yours: check.yours,
          queued: false,
          retryAfterSeconds: check.retryAfterSeconds,
        }),
      );
    }

    // Fetch contact names for the job queue UI display. A contact id this
    // account does not own is refused here, before any token is spent.
    const contacts: Array<{ id: string; name: string }> = [];
    for (const id of contactIds) {
      const contact = enrichmentContact(scope, id);
      contacts.push({ id: contact.id, name: contact.name });
    }

    // Join this account's running batch, when there is one. A batch that is
    // running holds the lock, so a second batch started beside it would never
    // run: a join that fails is refused, not turned into a new batch.
    if (check.appendTo) {
      const joined = jobQueue.appendToBatch(
        scope,
        check.appendTo,
        contacts,
        depth,
        choice,
      );
      if (!joined)
        throw new AppError(
          "Research is finishing. Try again in a moment.",
          409,
        );
      return res.json({
        batchId: joined.batch.id,
        jobCount: joined.added,
        appended: true,
      });
    }

    // Create batch
    const batch = jobQueue.createBatch(scope, contacts, choice, depth);

    // Kick off processing async (fire-and-forget — don't await)
    jobQueue.processBatch(batch.id).catch((err) => {
      log.error(
        "AISearchRoute",
        `Batch ${batch.id} processing error: ${getErrorMessage(err)}`,
      );
    });

    // Return batch ID immediately
    res.json({ batchId: batch.id, jobCount: batch.jobs.length });
  }),
);

// GET /ai-search/status — Poll batch status (fallback for SSE)

aiSearchRouter.get(
  "/ai-search/status",
  asyncHandler(async (req, res) => {
    const batchId = z.string().min(1).max(100).parse(req.query.batchId);

    const batch = jobQueue.getBatch(scopeOf(req), batchId);
    if (!batch) {
      throw new AppError("Batch not found.", 404);
    }

    res.json(batch);
  }),
);

// GET /ai-search/stream — SSE stream for real-time batch updates

aiSearchRouter.get("/ai-search/stream", (req, res) => {
  const batchId = z.string().min(1).max(100).parse(req.query.batchId);
  // Read before subscribing. The listener below runs in the async context of
  // whoever calls emit(), which is the job, so the owner has to be settled in
  // this closure while the request context is still the request's.
  const scope = scopeOf(req);
  const batch = jobQueue.getBatch(scope, batchId);
  if (!batch)
    throw new AppError("Batch not found. The server may have restarted.", 404);
  startStream(res, "text/event-stream");
  const send = (updated: AISearchBatch) => {
    if (res.destroyed || res.writableEnded) return;
    if (
      !res.write(`data: ${JSON.stringify(updated)}\n\n`) ||
      updated.status !== "processing"
    )
      res.end();
  };
  send(batch);
  if (res.writableEnded) return;
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded && !res.write(": heartbeat\n\n"))
      res.end();
  }, 15_000);
  heartbeat.unref();
  const cleanup = () => {
    clearInterval(heartbeat);
    jobQueue.off(batchId, send);
  };
  jobQueue.on(batchId, send);
  res.once("close", cleanup);
  res.once("finish", cleanup);
});

aiSearchRouter.post("/ai-search/:batchId/cancel", (req, res) => {
  const batchId = z.string().min(1).max(100).parse(req.params.batchId);
  const batch = jobQueue.cancelBatch(scopeOf(req), batchId);
  if (!batch) throw new AppError("Batch not found.", 404);
  res.json(batch);
});
