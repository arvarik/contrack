// The slim build parses with htmlparser2 and skips parse5 and the undici
// copy the full entry loads for cheerio.fromURL, which nothing here calls.
import * as cheerio from "cheerio/slim";
import path from "path";
import { AppError, ValidationError } from "../utils/AppError.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { ownerUploadDir, ownerUploadUrl } from "../utils/paths.ts";
import { ensureLocalImage, urlDigest } from "../utils/remoteImage.ts";
import { readBodyCapped, safeFetch } from "../utils/urlSafety.ts";
import type { Scope } from "../tenancy/scope.ts";

/** The page fetch, redirects included, and the read of its body. */
const PAGE_BUDGET_MS = 6000;
const PAGE_MAX_REDIRECTS = 3;

/** A preview card draws the image at most 192 px wide; 800 covers retina. */
const PREVIEW_MAX_SIZE = 800;
const PREVIEW_JPEG_QUALITY = 80;
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 6000;

/**
 * Copy a page's og:image into the caller's previews folder and return the
 * local URL, or null when there is no usable copy.
 *
 * The browser never loads the linked site's image: a note that shows it
 * would tell that site each time the note is opened. The file name is the
 * digest of the image URL, so a link unfurled twice reuses the first copy.
 */
async function localPreviewImage(
  scope: Scope,
  imageUrl: string,
): Promise<string | null> {
  try {
    const filename = `${urlDigest(imageUrl)}.jpg`;
    const outPath = path.join(
      ownerUploadDir(scope.ownerId, "previews"),
      filename,
    );
    await ensureLocalImage(
      imageUrl,
      outPath,
      (img) =>
        img
          .rotate()
          // Bounded in both directions, so a very tall image stays small.
          .resize(PREVIEW_MAX_SIZE, PREVIEW_MAX_SIZE, {
            fit: "inside",
            withoutEnlargement: true,
          })
          // JPEG has no alpha. A transparent PNG goes onto white, which
          // reads as intended on the card, instead of onto black.
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: PREVIEW_JPEG_QUALITY, mozjpeg: true }),
      { maxBytes: PREVIEW_MAX_BYTES, timeoutMs: PREVIEW_TIMEOUT_MS },
    );
    return ownerUploadUrl(scope.ownerId, "previews", filename);
  } catch (err) {
    log.debug(
      "LinkPreview",
      `A preview image was not saved: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/** The og:image as an absolute http(s) URL, resolved against the page. */
function resolveImageUrl(raw: string, pageUrl: string): string | null {
  if (!raw) return null;
  try {
    // Relative forms ("img.png", "../img.png", "//cdn/img.png", "/img.png")
    // all resolve against the page the tag came from, after redirects.
    const url = new URL(raw, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export const linkPreviewService = {
  /**
   * Unfurl a link: the page's title, description, and a local copy of its
   * og:image. `image` is a same-origin `/uploads/u/<owner>/previews/...`
   * path or an empty string, never a URL on another host.
   */
  async unfurlUrl(scope: Scope, targetUrl: string) {
    if (!targetUrl) throw new ValidationError("Missing link URL");

    // One budget for the page: every redirect hop and the body read.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PAGE_BUDGET_MS);

    let title: string;
    let description: string;
    let rawImage: string;
    let finalUrl: string;
    try {
      // safeFetch checks the URL before the first request (the same
      // ValidationError the separate check used to throw), re-checks every
      // redirect hop, and its socket lookup refuses a private address at
      // connect time. That last part closes the DNS rebinding gap a
      // check-then-fetch leaves open.
      let htmlRes: globalThis.Response;
      try {
        ({ response: htmlRes, finalUrl } = await safeFetch(targetUrl, {
          timeoutMs: PAGE_BUDGET_MS,
          maxRedirects: PAGE_MAX_REDIRECTS,
          signal: controller.signal,
        }));
      } catch (err) {
        if (err instanceof AppError && err.message === "Too many redirects") {
          throw new AppError(`Unfurl failed: too many redirects`, 502);
        }
        throw err;
      }

      const htmlText = await readBodyCapped(htmlRes, controller.signal);
      const $ = cheerio.load(htmlText);

      title =
        $('meta[property="og:title"]').attr("content") ||
        $("title").text() ||
        targetUrl;
      description =
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="description"]').attr("content") ||
        "";
      rawImage = $('meta[property="og:image"]').attr("content") || "";
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Unfurl failed parsing target host: ${targetUrl}`,
        502,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // The image has a budget of its own, after the page's. A preview whose
    // image fails is still a preview: it comes back without one.
    const imageUrl = resolveImageUrl(rawImage, finalUrl);
    const image = imageUrl ? await localPreviewImage(scope, imageUrl) : null;

    return { title, description, image: image ?? "", url: targetUrl };
  },
};
