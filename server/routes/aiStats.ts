// AI usage routes, mounted at /api/ai/stats:
//   GET /api/ai/stats/summary  totals, quota, cache tiers
//   GET /api/ai/stats/feed     the paginated, filterable call history

import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { adminRefusal } from "../middleware/auth.ts";
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
 * `?scope=all` is an admin read, but `requireAdmin` cannot sit on the route,
 * which without the parameter is every member's own usage page. So the manifest
 * classes both routes `scoped`, and the check is here, on the one shape that
 * crosses accounts. It is `requireAdmin`'s check, so an admin's token cannot
 * read it either.
 */
function wantsInstance(req: Request): boolean {
  if (req.query.scope !== "all") return false;
  const refused = adminRefusal(req);
  if (refused) throw refused;
  return true;
}

// Valid operation vocabulary — derived from the canonical AI_OPERATIONS list

const VALID_OPERATIONS = new Set<string>(AI_OPERATIONS);

// GET /summary

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    // The counts are the caller's own. `cacheTiers` describes the instance's
    // shared cache, so a member does not get it. `?scope=all` puts the
    // instance's counts in place of the caller's and adds the per-account
    // breakdown, for the operator whose provider key paid for it.
    const admin = req.principal?.user.role === "admin";
    const summary = getSummary(scopeOf(req), { admin });
    if (!wantsInstance(req)) return res.json(summary);

    const instance = getInstanceSummary();
    res.json({ ...summary, ...instance, scope: "all" });
  }),
);

// GET /feed

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
