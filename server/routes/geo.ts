import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { AppError, ValidationError } from "../utils/AppError.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { validateBody } from "../utils/validators.ts";
import { auditService } from "../services/auditService.ts";
import { notOnMap } from "../services/geocoding/index.ts";
import { searchPlace } from "../services/geocoding/search.ts";
import {
  GEOCODING_OFF_SETTING,
  geocodingLockedByEnv,
  geocodingState,
  nominatimBaseUrl,
  setGeocodingOff,
} from "../services/geocoding/switch.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { geoRoutes } from "../../shared/contracts/geo.ts";

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

/** The caller's contacts with an address and no pin, and why. */
router.get(
  "/status",
  asyncHandler(async (req, res) => {
    res.json({ contacts: notOnMap(scopeOf(req)) });
  }),
);

/** Whether the server sends addresses to Nominatim, for the admin page. */
router.get(
  "/lookups",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(geocodingState());
  }),
);

/**
 * Turn address lookups off, or back on, for every account. GEOCODING_DISABLED
 * holds them off, and a NOMINATIM_URL that is not a URL keeps them off, so
 * turning them on then answers 409 rather than a page that says "on".
 */
router.put(
  "/lookups",
  requireAdmin,
  validateBody(geoRoutes.setLookups.body),
  asyncHandler(async (req, res) => {
    const off = req.body.off === true;
    if (!off && geocodingLockedByEnv()) {
      throw new AppError(
        "Address lookups are off by environment variable GEOCODING_DISABLED, so they cannot be turned on here",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }
    if (!off && nominatimBaseUrl() === null) {
      throw new AppError(
        "NOMINATIM_URL is not an http or https URL, so address lookups stay off",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }
    setGeocodingOff(off);
    auditService.record({
      actorUserId: req.principal?.user.id ?? null,
      action: "settings.changed",
      targetType: "setting",
      targetId: GEOCODING_OFF_SETTING,
      details: { off },
      ip: req.ip ?? null,
    });
    res.json(geocodingState());
  }),
);

export const geoRouter = router;
