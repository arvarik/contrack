import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { linkPreviewService } from "../services/linkPreviewService.ts";
import { scopeOf } from "../tenancy/scope.ts";

const router = Router();

router.get(
  "/unfurl",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const targetUrl = req.query.url as string;

    if (!targetUrl) throw new AppError("url query parameter is required", 400);

    // The preview image is saved in the caller's own uploads folder, so the
    // service needs to know whose request this is.
    const result = await linkPreviewService.unfurlUrl(scopeOf(req), targetUrl);
    log.debug("API", `[${rid}] GET /api/link-preview/unfurl → unfurled`);
    res.json(result);
  }),
);

export const linkPreviewRouter = router;
