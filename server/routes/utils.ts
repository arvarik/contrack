import { Router } from "express";
import * as cheerio from "cheerio";
import { log } from "../logger.ts";

const router = Router();

router.get("/unfurl", async (req, res) => {
  const rid = (req as any).requestId;
  try {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).json({ error: "Missing link URL" });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

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
    log.error("API", `[${rid}] /unfurl failed on ${req.query.url}`, { error: err.message });
    res.status(500).json({ error: "Unfurl failed parsing target host", url: req.query.url });
  }
});

export const utilsRouter = router;
