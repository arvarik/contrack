import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { AppError, ValidationError } from "../utils/AppError.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";
import { searchPlace } from "../services/geocoding/search.ts";

const router = Router();

export const geoSearchLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  name: "place search",
  keyBy: (req) => req.principal?.user.id ?? req.ip ?? "unknown",
});

export function __resetGeoSearchLimiter(): void {
  geoSearchLimiter.reset();
}

router.get(
  "/search",
  geoSearchLimiter,
  asyncHandler(async (req, res) => {
    const rawQ = req.query.q;
    if (typeof rawQ !== "string") {
      throw new ValidationError("Query parameter q is required");
    }

    const q = rawQ.trim();
    if (q.length < 2 || q.length > 120) {
      throw new ValidationError(
        "Query parameter q must be between 2 and 120 characters",
      );
    }

    const result = await searchPlace(q);
    if (!result) {
      throw new AppError("Nothing found for that place", 404, {
        code: "NO_RESULT",
      });
    }

    res.json(result);
  }),
);

export const geoRouter = router;
