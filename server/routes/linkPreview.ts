import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { AppError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { linkPreviewService } from "../services/linkPreviewService.ts";

const router = Router();

router.get(
  "/unfurl",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const targetUrl = req.query.url as string;

    if (!targetUrl) throw new AppError("url query parameter is required", 400);

    const result = await linkPreviewService.unfurlUrl(targetUrl);
    log.debug(
      "API",
      `[${rid}] GET /api/link-preview/unfurl extracted ${result.title}`,
    );
    res.json(result);
  }),
);

export const linkPreviewRouter = router;
