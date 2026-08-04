// =============================================================================
// Routes — AI Stats (Invocation History & Usage Dashboard)
// =============================================================================
// Two endpoints for the AI Stats Page (/settings/ai-stats):
//   GET /api/ai/stats/summary  — aggregate KPIs, quota, cache tiers
//   GET /api/ai/stats/feed     — paginated, filterable invocation history
//
// Mounted in server.ts at /api/ai/stats.
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  getSummary,
  getFeed,
  AI_OPERATIONS,
} from "../services/aiStatsService.ts";
import type { AIOperation } from "../services/aiStatsService.ts";

const router = Router();

// =============================================================================
// Valid operation vocabulary — derived from the canonical AI_OPERATIONS list
// =============================================================================

const VALID_OPERATIONS = new Set<string>(AI_OPERATIONS);

// =============================================================================
// GET /summary
// =============================================================================

router.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const summary = getSummary();
    res.json(summary);
  }),
);

// =============================================================================
// GET /feed
// =============================================================================

const feedQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  operation: z.string().optional(),
  cached: z.enum(["true", "false"]).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

router.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const parsed = feedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { offset, limit, operation, cached, sort } = parsed.data;

    // Parse comma-separated operation filter
    let operations: string[] | undefined;
    if (operation) {
      operations = operation
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = operations.filter((op) => !VALID_OPERATIONS.has(op));
      if (invalid.length > 0) {
        res.status(400).json({
          error: `Invalid operation filter(s): ${invalid.join(", ")}. Valid values: ${[...VALID_OPERATIONS].join(", ")}`,
        });
        return;
      }
    }

    const result = getFeed({
      offset,
      limit,
      operations,
      cached: cached === undefined ? undefined : cached === "true",
      sort,
    });

    res.json(result);
  }),
);

export const aiStatsRouter = router;
