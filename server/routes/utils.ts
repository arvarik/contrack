import { Router } from "express";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import * as cheerio from "cheerio";
import { log } from "../logger.ts";

const router = Router();

router.get("/unfurl", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const targetUrl = req.query.url as string;
  if (!targetUrl) throw new AppError("Missing link URL", 400);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const htmlRes = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    const htmlText = await htmlRes.text();
    const $ = cheerio.load(htmlText);

    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || targetUrl;
    const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    let image = $('meta[property="og:image"]').attr('content') || '';
    
    if (image && image.startsWith('/')) {
      const urlObj = new URL(targetUrl);
      image = `${urlObj.origin}${image}`;
    }

    log.debug("API", `[${rid}] GET /api/utils/unfurl extracted ${title}`);
    res.json({ title, description, image, url: targetUrl });
  } catch (err: any) {
    throw new AppError(`Unfurl failed parsing target host: ${targetUrl}`, 500);
  }
}));

export const utilsRouter = router;
