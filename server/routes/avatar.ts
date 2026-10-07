// Avatar rendering at /api/avatar, so no contact name leaves the machine for a
// third-party avatar service. It stores nothing: the response is a pure
// function of (style, seed, bg, theme, look) and avatarService's presets, so
// HTTP caching is the whole cache:
//   - `max-age` spares the browser a day of requests, so a list of 200 avatars
//     is cheap after the first paint.
//   - Express's ETag makes a revalidation a 304 with no body.
//   - The ETag comes from the bytes, so changing a preset invalidates every
//     avatar with no version in the URL.

import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { ValidationError } from "../utils/AppError.ts";
import {
  AVATAR_STYLES,
  isAvatarStyle,
  isAvatarTheme,
  parseAvatarLook,
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

    // An absent or unrecognized `theme` is not an error: the monogram then
    // carries its own `prefers-color-scheme` rule and answers for both
    // palettes, which is what the default `system` theme wants.
    const theme = isAvatarTheme(req.query.theme) ? req.query.theme : undefined;

    // `look` is how a contact's pronouns reach the face (`f`, `m` or `n`).
    // Absent or unrecognized, the avatar service reads the look from the seed.
    const look = parseAvatarLook(req.query.look);

    const svg = renderAvatar({
      style,
      seed,
      background: req.query.bg === "1",
      theme,
      look,
    });

    res.set("Cache-Control", `public, max-age=${MAX_AGE_SECONDS}`);
    res.type("image/svg+xml").send(svg);
  }),
);

export const avatarRouter = router;
