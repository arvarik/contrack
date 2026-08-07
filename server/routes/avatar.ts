// =============================================================================
// Routes — Avatar rendering
// =============================================================================
// Mounted at /api/avatar. Replaces the `api.dicebear.com` URLs that used to be
// embedded in every contact row, so no contact name leaves the machine.
//
// Deliberately stores nothing. The response is a pure function of (style, seed,
// bg) plus the presets in avatarService, so HTTP caching is the whole cache:
//
//   - `max-age` keeps the browser from asking again for a day, which is what
//     makes a list of 200 avatars cheap after the first paint.
//   - Express's ETag then makes the revalidation a 304 with no body.
//   - Because the ETag is derived from the bytes, changing an expression preset
//     invalidates every avatar automatically. A URL-embedded version would have
//     meant a database migration every time we adjusted an eyebrow.
// =============================================================================

import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { ValidationError } from "../utils/AppError.ts";
import {
  AVATAR_STYLES,
  isAvatarStyle,
  renderAvatar,
} from "../services/avatarService.ts";

const router = Router();

/** One day fresh, then a cheap conditional request. */
const MAX_AGE_SECONDS = 60 * 60 * 24;

/**
 * A seed is a contact name, so it can be almost anything — but it should not be
 * unbounded, since it is echoed into generation.
 */
const MAX_SEED_LENGTH = 200;

router.get(
  "/avatar/:style",
  asyncHandler(async (req, res) => {
    const style = String(req.params.style);
    if (!isAvatarStyle(style)) {
      throw new ValidationError(
        `Unknown avatar style "${style}". Expected one of: ${AVATAR_STYLES.join(", ")}`,
      );
    }

    const seed = String(req.query.seed ?? "").slice(0, MAX_SEED_LENGTH);
    if (!seed.trim()) {
      throw new ValidationError("An avatar needs a seed");
    }

    const svg = renderAvatar({
      style,
      seed,
      background: req.query.bg === "1",
    });

    res.set("Cache-Control", `public, max-age=${MAX_AGE_SECONDS}`);
    res.type("image/svg+xml").send(svg);
  }),
);

export const avatarRouter = router;
