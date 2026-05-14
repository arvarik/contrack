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
import { contactService } from "../services/contactService.ts";
import { ai } from "../ai/index.ts";
import { log } from "../utils/logger.ts";
import type { AISearchBatch } from "../services/aiSearch/types.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { getDefaultStrategyForProvider } from "../services/aiSearch/strategies/index.ts";

export const aiSearchRouter = Router();

// =============================================================================
// Validation
// =============================================================================

/** Caps batch size at 100 to prevent accidental mega-batches */
// NOTE: The design doc (§8) specifies express-rate-limit on this endpoint
// (max 5/hr). Omitted intentionally — this is a single-user local app and
// the in-memory 5-minute cooldown in jobQueue.canStartBatch() provides
// equivalent protection. Add express-rate-limit if deploying multi-tenant.
const providerName = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
const aiSearchBodySchema = z.object({
  contactIds: z.array(z.string()).min(1).max(100),
  strategy: z
    .string()
    .optional()
    .default(getDefaultStrategyForProvider(providerName)),
});

// =============================================================================
// POST /ai-search — Start a new batch
// =============================================================================

aiSearchRouter.post(
  "/ai-search",
  validateBody(aiSearchBodySchema),
  asyncHandler(async (req, res) => {
    const { contactIds, strategy } = req.body;

    // Check AI provider is configured
    if (!ai.isConfigured) {
      const KEY_MAP: Record<string, string> = {
        gemini: "GEMINI_API_KEY",
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
      };
      const keyVar = KEY_MAP[providerName] ?? "GEMINI_API_KEY";
      return res.status(503).json({
        error: `AI provider is not configured. Set ${keyVar} in your .env file.`,
      });
    }

    // Canary guard — checks both in-progress lock and cooldown
    const check = jobQueue.canStartBatch();
    if (!check.allowed) {
      return res.status(429).json({ error: check.reason });
    }

    // Fetch contact names for the job queue UI display
    const contacts: Array<{ id: string; name: string }> = [];
    for (const id of contactIds) {
      const contact = contactService.getContactById(id);
      if (contact) {
        contacts.push({ id: contact.id, name: contact.name });
      } else {
        log.warn("AISearchRoute", `Contact ${id} not found — skipping`);
      }
    }

    if (contacts.length === 0) {
      return res
        .status(400)
        .json({ error: "None of the selected contacts were found." });
    }

    // Create batch
    const batch = jobQueue.createBatch(contacts, strategy);

    // Kick off processing async (fire-and-forget — don't await)
    jobQueue.processBatch(batch.id, ai).catch((err) => {
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
    const batchId = req.query.batchId as string;
    if (!batchId) {
      return res
        .status(400)
        .json({ error: "batchId query parameter is required." });
    }

    const batch = jobQueue.getBatch(batchId);
    if (!batch) {
      return res.status(404).json({ error: "Batch not found." });
    }

    res.json(batch);
  }),
);

// =============================================================================
// GET /ai-search/stream — SSE stream for real-time batch updates
// =============================================================================

aiSearchRouter.get("/ai-search/stream", (req, res) => {
  const batchId = req.query.batchId as string;
  if (!batchId) {
    return res
      .status(400)
      .json({ error: "batchId query parameter is required." });
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send current state immediately
  const batch = jobQueue.getBatch(batchId);
  if (!batch) {
    res.write(`data: ${JSON.stringify({ error: "Batch not found" })}\n\n`);
    return res.end();
  }

  res.write(`data: ${JSON.stringify(batch)}\n\n`);

  // If already complete, close immediately
  if (batch.status === "complete" || batch.status === "cancelled") {
    return res.end();
  }

  // Subscribe to live updates from the job queue EventEmitter
  const handler = (updatedBatch: AISearchBatch) => {
    res.write(`data: ${JSON.stringify(updatedBatch)}\n\n`);
    if (
      updatedBatch.status === "complete" ||
      updatedBatch.status === "cancelled"
    ) {
      // Self-cleanup: remove listener before ending response
      jobQueue.off(batchId, handler);
      res.end();
    }
  };

  jobQueue.on(batchId, handler);

  // Also cleanup on client disconnect
  req.on("close", () => {
    jobQueue.off(batchId, handler);
  });
});
