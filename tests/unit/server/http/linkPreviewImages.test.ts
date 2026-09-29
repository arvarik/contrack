// =============================================================================
// Link previews — the image is a local copy, never the linked site's URL
// =============================================================================
// A preview card used to carry the page's og:image URL, and the browser
// loaded it from the linked site each time the note was drawn. The unfurl
// now downloads that image once, re-encodes it, stores it in the caller's
// uploads/u/<owner>/previews/, and answers with the local path. A failed
// image gives a preview without one, and the remote URL never appears in the
// response.
//
// The page fetch goes through safeFetch too (it closes the DNS rebinding gap
// the old fetch loop left), so one stub serves both the page and the image.
// The route, with real sign-in and two accounts, is tested in
// tests/integration/tenancy.isolation.test.ts.
// =============================================================================

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("../../../../server/utils/urlSafety.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/urlSafety.ts")
  >()),
  safeFetch: safeFetchMock,
}));

import fs from "node:fs";
import sharp from "sharp";
import { linkPreviewService } from "../../../../server/services/linkPreviewService.ts";
import { scopeForOwnerId } from "../../../../server/tenancy/scope.ts";
import {
  AppError,
  ValidationError,
} from "../../../../server/utils/AppError.ts";
import { resolveUploadPath } from "../../../../server/utils/paths.ts";

const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const scope = scopeForOwnerId(OWNER_ID);

const PAGE_URL = "https://news.example.com/story";
const FINAL_URL = "https://www.news.example.com/2026/story";

let image: Buffer;

/** A page with an og:image, resolved against where the page ended up. */
function page(ogImage: string): string {
  return `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="A story">
    <meta property="og:description" content="What happened">
    <meta property="og:image" content="${ogImage}">
  </head><body></body></html>`;
}

/** Route safeFetch by URL: the page, then whatever image URL it names. */
function serve(
  html: string,
  imageReply: (url: string) => Response | Promise<Response>,
) {
  safeFetchMock.mockImplementation(async (url: string) => {
    if (url === PAGE_URL) {
      return {
        response: new Response(html, {
          headers: { "content-type": "text/html" },
        }),
        finalUrl: FINAL_URL,
      };
    }
    return { response: await imageReply(url), finalUrl: url };
  });
}

const pngReply = () =>
  new Response(new Uint8Array(image), {
    headers: { "content-type": "image/png" },
  });

beforeAll(async () => {
  image = await sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 4,
      background: { r: 250, g: 180, b: 0, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("linkPreviewService.unfurlUrl", () => {
  it("answers with a local preview image, and the file exists", async () => {
    // A relative path with no leading slash: resolved against the FINAL
    // page URL, which the old code could not do.
    serve(page("media/og.png?w=1600"), pngReply);

    const result = await linkPreviewService.unfurlUrl(scope, PAGE_URL);

    expect(result.title).toBe("A story");
    expect(result.description).toBe("What happened");
    expect(result.url).toBe(PAGE_URL);
    expect(result.image).toMatch(
      new RegExp(`^/uploads/u/${OWNER_ID}/previews/[0-9a-f]{24}\\.jpg$`),
    );
    expect(safeFetchMock.mock.calls.map(([u]) => u)).toEqual([
      PAGE_URL,
      "https://www.news.example.com/2026/media/og.png?w=1600",
    ]);

    const onDisk = resolveUploadPath(result.image);
    expect(onDisk && fs.existsSync(onDisk)).toBe(true);
    const meta = await sharp(onDisk!).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(450);
  });

  it("never puts the remote image URL in the response", async () => {
    const remote = "https://cdn.tracker.example/og/abc123.png";
    serve(page(remote), pngReply);
    const result = await linkPreviewService.unfurlUrl(scope, PAGE_URL);
    expect(JSON.stringify(result)).not.toContain("tracker.example");
    expect(result.image.startsWith("/uploads/")).toBe(true);
  });

  it("reuses the stored copy when the same image is unfurled again", async () => {
    serve(page("https://img.example/shared.png"), pngReply);
    const first = await linkPreviewService.unfurlUrl(scope, PAGE_URL);
    safeFetchMock.mockClear();
    const second = await linkPreviewService.unfurlUrl(scope, PAGE_URL);
    expect(second.image).toBe(first.image);
    // The page is fetched again, the image is not.
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives no image when the image download fails", async () => {
    const remote = "https://img.example/missing.png";
    serve(page(remote), () => new Response("gone", { status: 404 }));
    const result = await linkPreviewService.unfurlUrl(scope, PAGE_URL);
    expect(result.image).toBe("");
    expect(result.title).toBe("A story");
    expect(JSON.stringify(result)).not.toContain("img.example");
  });

  it("gives no image when the og:image is not a raster image", async () => {
    serve(
      page("https://img.example/logo.svg"),
      () =>
        new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
          headers: { "content-type": "image/svg+xml" },
        }),
    );
    const result = await linkPreviewService.unfurlUrl(scope, PAGE_URL);
    expect(result.image).toBe("");
  });

  it("ignores an og:image that is not http(s)", async () => {
    serve(page("javascript:alert(1)"), pngReply);
    const result = await linkPreviewService.unfurlUrl(scope, PAGE_URL);
    expect(result.image).toBe("");
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives no image when the page names none", async () => {
    serve(page(""), pngReply);
    const result = await linkPreviewService.unfurlUrl(scope, PAGE_URL);
    expect(result.image).toBe("");
  });

  it("keeps the old error for a redirect chain that is too long", async () => {
    safeFetchMock.mockRejectedValue(new AppError("Too many redirects", 502));
    await expect(linkPreviewService.unfurlUrl(scope, PAGE_URL)).rejects.toThrow(
      "Unfurl failed: too many redirects",
    );
  });

  it("keeps the old error when the page fetch fails", async () => {
    safeFetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(linkPreviewService.unfurlUrl(scope, PAGE_URL)).rejects.toThrow(
      `Unfurl failed parsing target host: ${PAGE_URL}`,
    );
  });

  it("passes safeFetch's refusal of a private address through unchanged", async () => {
    const refused = new ValidationError("URL resolves to a private address");
    safeFetchMock.mockRejectedValue(refused);
    await expect(
      linkPreviewService.unfurlUrl(scope, "http://10.0.0.8/"),
    ).rejects.toBe(refused);
  });

  it("refuses an empty URL", async () => {
    await expect(linkPreviewService.unfurlUrl(scope, "")).rejects.toThrow(
      "Missing link URL",
    );
  });
});
