import * as cheerio from "cheerio";
import { AppError } from "../utils/AppError.ts";

export const linkPreviewService = {
  async unfurlUrl(targetUrl: string) {
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

      return { title, description, image, url: targetUrl };
    } catch (err: unknown) {
      throw new AppError(`Unfurl failed parsing target host: ${targetUrl}`, 500);
    }
  }
};
