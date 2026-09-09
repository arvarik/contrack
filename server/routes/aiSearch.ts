// =============================================================================
// AI Search — API Routes
// =============================================================================
// POST /api/ai-search        — Start a new batch
// GET  /api/ai-search/status — Poll batch status (fallback for SSE)
// GET  /api/ai-search/stream — SSE stream for real-time batch updates
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../utils/validators.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { jobQueue } from "../services/aiSearch/index.ts";
import { log } from "../utils/logger.ts";
import type { AISearchBatch } from "../services/aiSearch/types.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { validateEnrichmentStrategy } from "../services/aiSearch/strategies/index.ts";
import { enrichmentContact } from "../services/aiSearch/contactSnapshot.ts";
import { AppError, RateLimitedError } from "../utils/AppError.ts";
import { scopeOf } from "../tenancy/scope.ts";

export const aiSearchRouter = Router();

// =============================================================================
// Validation
// =============================================================================

/** Caps batch size at 100 to prevent accidental mega-batches */
// NOTE: The design doc (§8) specifies express-rate-limit on this endpoint
// (max 5/hr). Omitted intentionally — this is a single-user local app and
// the in-memory 5-minute cooldown in jobQueue.canStartBatch() provides
// equivalent protection. Add express-rate-limit if deploying multi-tenant.
const aiSearchBodySchema = z.object({
  contactIds: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(100)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Contact IDs must be unique",
    ),
  strategy: z.enum(["two-pass", "single-pass", "searxng"]).optional(),
});

// =============================================================================
// POST /ai-search — Start a new batch
// =============================================================================

aiSearchRouter.post(
  "/ai-search",
  validateBody(aiSearchBodySchema),
  asyncHandler(async (req, res, next) => {
    const scope = scopeOf(req);
    const { contactIds, strategy: requestedStrategy } = req.body;

    const strategy = validateEnrichmentStrategy(requestedStrategy);

    // Canary guard — the global run lock and this account's own cooldown.
    const check = jobQueue.canStartBatch(scope);
    if (!check.allowed) {
      // This used to be a bare `res.status(429).json({ error: string })`,
      // which is the one place in the API that did not send the standard
      // envelope. `details.yours` says whether the caller's own cooldown
      // refused, or somebody else's batch holds the shared provider lock.
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

    // Create batch
    const batch = jobQueue.createBatch(scope, contacts, strategy);

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

// =============================================================================
// GET /ai-search/status — Poll batch status (fallback for SSE)
// =============================================================================

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

// =============================================================================
// GET /ai-search/stream — SSE stream for real-time batch updates
// =============================================================================

aiSearchRouter.get("/ai-search/stream", (req, res) => {
  const batchId = z.string().min(1).max(100).parse(req.query.batchId);
  // Read before subscribing. The listener below runs in the async context of
  // whoever calls emit(), which is the job, so the owner has to be settled in
  // this closure while the request context is still the request's.
  const scope = scopeOf(req);
  const batch = jobQueue.getBatch(scope, batchId);
  if (!batch)
    throw new AppError("Batch not found. The server may have restarted.", 404);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
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
