// =============================================================================
// Routes — AI Stats (Invocation History & Usage Dashboard)
// =============================================================================
// Two endpoints for the AI Stats Page (/settings/ai-stats):
//   GET /api/ai/stats/summary  — aggregate KPIs, quota, cache tiers
//   GET /api/ai/stats/feed     — paginated, filterable invocation history
//
// Mounted in server.ts at /api/ai/stats.
// =============================================================================

import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import {
  getSummary,
  getFeed,
  getInstanceSummary,
  getInstanceFeed,
  AI_OPERATIONS,
} from "../services/aiStatsService.ts";

const router = Router();

/**
 * Whether this request asked for the instance rather than the caller.
 *
 * `?scope=all` is an admin read, and `requireAdmin` cannot sit on the route
 * because the same route without the parameter is every member's own billing
 * page. The manifest classes both routes `scoped` for that reason and the
 * check happens here, on the one shape that crosses accounts.
 */
function wantsInstance(req: Request): boolean {
  if (req.query.scope !== "all") return false;
  if (req.principal?.user.role === "admin") return true;
  throw new AppError("Instance-wide AI usage needs an admin account.", 403, {
    code: "ADMIN_REQUIRED",
  });
}

// =============================================================================
// Valid operation vocabulary — derived from the canonical AI_OPERATIONS list
// =============================================================================

const VALID_OPERATIONS = new Set<string>(AI_OPERATIONS);

// =============================================================================
// GET /summary
// =============================================================================

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    // The invocation counts are the caller's own. `cacheTiers` describes the
    // instance's shared in-process cache, so it is admin-only and simply
    // absent for a member. `?scope=all` replaces the caller's counts with the
    // instance's and adds the per-account breakdown, for the operator whose
    // provider key paid for all of it.
    const admin = req.principal?.user.role === "admin";
    const summary = getSummary(scopeOf(req), { admin });
    if (!wantsInstance(req)) return res.json(summary);

    const instance = getInstanceSummary();
    res.json({ ...summary, ...instance, scope: "all" });
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

    const params = {
      offset,
      limit,
      operations,
      cached: cached === undefined ? undefined : cached === "true",
      sort,
    };
    // The instance feed names the account behind each call and leaves the
    // description out. A description can carry a fragment of what somebody
    // asked about, and the billing view has no business showing it.
    const result = wantsInstance(req)
      ? { ...getInstanceFeed(params), scope: "all" }
      : getFeed(scopeOf(req), params);

    res.json(result);
  }),
);

export const aiStatsRouter = router;
