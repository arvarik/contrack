import * as cheerio from "cheerio";
import { AppError, ValidationError } from "../utils/AppError.ts";
import {
  assertPublicHttpUrl,
  readBodyCapped,
  isPrivateAddress,
} from "../utils/urlSafety.ts";

export const linkPreviewService = {
  async unfurlUrl(targetUrl: string) {
    if (!targetUrl) throw new ValidationError("Missing link URL");

    await assertPublicHttpUrl(targetUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      // `redirect: "manual"` so a public host can't 302 us into a private
      // address — we re-validate each hop ourselves (max 3).
      let currentUrl = targetUrl;
      let htmlRes: globalThis.Response | null = null;
      for (let hop = 0; hop < 3; hop++) {
        const res = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) break;
          currentUrl = new URL(location, currentUrl).toString();
          await assertPublicHttpUrl(currentUrl);
          continue;
        }
        htmlRes = res;
        break;
      }
      if (!htmlRes) {
        throw new AppError(`Unfurl failed: too many redirects`, 502);
      }

      const htmlText = await readBodyCapped(htmlRes);
      const $ = cheerio.load(htmlText);

      const title =
        $('meta[property="og:title"]').attr("content") ||
        $("title").text() ||
        targetUrl;
      const description =
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="description"]').attr("content") ||
        "";
      let image = $('meta[property="og:image"]').attr("content") || "";

      if (image && image.startsWith("/")) {
        const urlObj = new URL(currentUrl);
        image = `${urlObj.origin}${image}`;
      }

      return { title, description, image, url: targetUrl };
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Unfurl failed parsing target host: ${targetUrl}`,
        502,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

// Re-exported for the existing unit tests; the implementations now live in
// server/utils/urlSafety.ts and are shared with the SearXNG strategy.
export const _internal = { isPrivateAddress, assertPublicHttpUrl };
