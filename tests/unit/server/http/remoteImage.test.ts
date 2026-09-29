// =============================================================================
// Remote images — the server's one download of a third-party image
// =============================================================================
// server/utils/remoteImage.ts is the path every logo, Google contact photo
// and link-preview image takes before it reaches disk. These tests pin what
// it accepts (raster images only), what it refuses (SVG, HTML, too large),
// and how it labels each failure, because the logo cache writes a 30-day
// miss for a permanent failure and must never write one for a transient one.
//
// The network is stubbed at safeFetch. Everything after it is real: the
// capped binary reader, sharp's format check, and the atomic writer.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock("../../../../server/utils/urlSafety.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/urlSafety.ts")
  >()),
  safeFetch: safeFetchMock,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import {
  RemoteImageError,
  ensureLocalImage,
  fetchRemoteImage,
  imageHost,
  isTransientImageError,
  urlDigest,
  writeFileAtomically,
  writeImageAtomically,
} from "../../../../server/utils/remoteImage.ts";
import {
  UNRESOLVABLE_HOST_MESSAGE,
  readBytesCapped,
} from "../../../../server/utils/urlSafety.ts";
import {
  AppError,
  ValidationError,
} from "../../../../server/utils/AppError.ts";

const IMAGE_URL = "https://images.example.com/photo.png?token=secret";

/** A small real image in the given format. */
function makeImage(
  format: "png" | "jpeg" | "webp" | "avif" | "gif",
  size = 32,
): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 200, g: 40, b: 40, alpha: 0.6 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

/** What safeFetch resolves with: a response and the final URL. */
function served(
  body: Buffer | string,
  init: { status?: number; type?: string; length?: string } = {},
) {
  const headers = new Headers({ "content-type": init.type ?? "image/png" });
  if (init.length) headers.set("content-length", init.length);
  const bytes = typeof body === "string" ? body : new Uint8Array(body);
  return {
    response: new Response(bytes, { status: init.status ?? 200, headers }),
    finalUrl: IMAGE_URL,
  };
}

/** Run fetchRemoteImage and return the error it throws. */
async function failure(
  options: Parameters<typeof fetchRemoteImage>[1] = {},
): Promise<unknown> {
  try {
    await fetchRemoteImage(IMAGE_URL, options);
  } catch (err) {
    return err;
  }
  throw new Error("fetchRemoteImage resolved; a failure was expected");
}

let dir: string;

beforeEach(() => {
  safeFetchMock.mockReset();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "contrack-remote-image-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("fetchRemoteImage", () => {
  it.each(["png", "jpeg", "webp", "gif", "avif"] as const)(
    "accepts a %s image and returns its bytes",
    async (format) => {
      const image = await makeImage(format);
      safeFetchMock.mockResolvedValueOnce(
        served(image, { type: `image/${format}` }),
      );
      const bytes = await fetchRemoteImage(IMAGE_URL);
      expect(Buffer.compare(bytes, image)).toBe(0);
    },
  );

  it("goes through safeFetch with the timeout and three redirects", async () => {
    safeFetchMock.mockResolvedValueOnce(served(await makeImage("png")));
    await fetchRemoteImage(IMAGE_URL, { timeoutMs: 1234 });
    expect(safeFetchMock).toHaveBeenCalledWith(
      IMAGE_URL,
      expect.objectContaining({ timeoutMs: 1234, maxRedirects: 3 }),
    );
  });

  it("refuses an SVG as a permanent failure, whatever the header says", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>';
    safeFetchMock.mockResolvedValueOnce(served(svg, { type: "image/png" }));
    const err = await failure();
    expect(err).toBeInstanceOf(RemoteImageError);
    expect((err as RemoteImageError).transient).toBe(false);
    expect((err as Error).message).toContain("svg");
  });

  it("refuses an HTML page as a permanent failure", async () => {
    safeFetchMock.mockResolvedValueOnce(
      served("<!doctype html><title>Not found</title>", { type: "text/html" }),
    );
    const err = await failure();
    expect(err).toBeInstanceOf(RemoteImageError);
    expect((err as RemoteImageError).transient).toBe(false);
    expect((err as Error).message).toContain("not an image");
  });

  it("refuses a declared length over the cap without reading the body", async () => {
    const reply = served(await makeImage("png"), { length: "999999" });
    const cancel = vi.spyOn(reply.response.body!, "cancel");
    safeFetchMock.mockResolvedValueOnce(reply);
    const err = await failure({ maxBytes: 1000 });
    expect((err as RemoteImageError).transient).toBe(false);
    expect((err as Error).message).toContain("larger than 1000 bytes");
    expect(cancel).toHaveBeenCalled();
  });

  it("refuses a body over the cap when no length was declared", async () => {
    const big = await makeImage("png", 256);
    safeFetchMock.mockResolvedValueOnce(served(big));
    const err = await failure({ maxBytes: 100 });
    expect(err).toBeInstanceOf(RemoteImageError);
    expect((err as RemoteImageError).transient).toBe(false);
  });

  it.each([
    [404, false],
    [403, false],
    [410, false],
    [500, true],
    [503, true],
    [429, true],
    [408, true],
  ])("labels an HTTP %i as transient=%s", async (status, transient) => {
    safeFetchMock.mockResolvedValueOnce(served("no", { status }));
    const err = await failure();
    expect(err).toBeInstanceOf(RemoteImageError);
    expect((err as RemoteImageError).transient).toBe(transient);
    expect(isTransientImageError(err)).toBe(transient);
  });

  it("labels a network failure as transient", async () => {
    safeFetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await failure();
    expect((err as RemoteImageError).transient).toBe(true);
  });

  it("labels a host that does not resolve as transient", async () => {
    safeFetchMock.mockRejectedValueOnce(
      new ValidationError(UNRESOLVABLE_HOST_MESSAGE),
    );
    const err = await failure();
    expect((err as RemoteImageError).transient).toBe(true);
  });

  it("labels a private address as permanent", async () => {
    safeFetchMock.mockRejectedValueOnce(
      new ValidationError("URL resolves to a private address"),
    );
    const err = await failure();
    expect((err as RemoteImageError).transient).toBe(false);
  });

  it("labels too many redirects as permanent", async () => {
    safeFetchMock.mockRejectedValueOnce(
      new AppError("Too many redirects", 502),
    );
    const err = await failure();
    expect((err as RemoteImageError).transient).toBe(false);
  });

  it("labels its own deadline as a transient timeout", async () => {
    safeFetchMock.mockImplementationOnce(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason),
          );
        }),
    );
    const err = await failure({ timeoutMs: 20 });
    expect((err as RemoteImageError).transient).toBe(true);
    expect((err as Error).message).toContain("timed out");
  });

  it("rethrows the caller's abort as it is, not as an image failure", async () => {
    const controller = new AbortController();
    const reason = new Error("sync cancelled");
    safeFetchMock.mockImplementationOnce(async () => {
      controller.abort(reason);
      throw new DOMException("aborted", "AbortError");
    });
    const err = await failure({ signal: controller.signal });
    expect(err).toBe(reason);
  });

  it("does not start when the caller has already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already gone"));
    const err = await failure({ signal: controller.signal });
    expect((err as Error).message).toBe("already gone");
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe("readBytesCapped", () => {
  it("returns the whole body under the cap", async () => {
    const res = new Response(new Uint8Array([1, 2, 3, 4]));
    const bytes = await readBytesCapped(res, 10);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });

  it("throws, rather than truncating, once the body passes the cap", async () => {
    const res = new Response(new Uint8Array(64));
    await expect(readBytesCapped(res, 10)).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("returns an empty buffer for a response with no body", async () => {
    const bytes = await readBytesCapped(new Response(null), 10);
    expect(bytes.byteLength).toBe(0);
  });
});

describe("writeImageAtomically", () => {
  it("re-encodes the image and leaves no temporary file behind", async () => {
    const out = path.join(dir, "nested", "logo.png");
    await writeImageAtomically(await makeImage("jpeg", 300), out, (img) =>
      img.resize(128, 128, { fit: "inside" }).png(),
    );
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(128);
    expect(fs.readdirSync(path.dirname(out))).toEqual(["logo.png"]);
  });

  it("writes nothing when the image does not decode, and says so permanently", async () => {
    const out = path.join(dir, "broken.png");
    const err = await writeImageAtomically(
      Buffer.from("not an image"),
      out,
      (img) => img.png(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteImageError);
    expect((err as RemoteImageError).transient).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("writeFileAtomically", () => {
  it("replaces an existing file in one step", async () => {
    const out = path.join(dir, "marker.miss");
    await writeFileAtomically(out, "first");
    await writeFileAtomically(out, "second");
    expect(fs.readFileSync(out, "utf8")).toBe("second");
    expect(fs.readdirSync(dir)).toEqual(["marker.miss"]);
  });

  it("removes its temporary file when the rename fails", async () => {
    // A directory where the file should go makes the rename fail.
    const out = path.join(dir, "taken");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "keep"), "x");
    await expect(writeFileAtomically(out, "data")).rejects.toThrow();
    expect(fs.readdirSync(dir)).toEqual(["taken"]);
  });
});

describe("ensureLocalImage", () => {
  const toJpeg = (img: Sharp) => img.resize(16, 16).jpeg();

  it("downloads once, then reuses the file with no network call", async () => {
    const out = path.join(dir, "copy.jpg");
    safeFetchMock.mockResolvedValue(served(await makeImage("png")));
    await ensureLocalImage(IMAGE_URL, out, toJpeg);
    expect((await sharp(out).metadata()).format).toBe("jpeg");
    await ensureLocalImage(IMAGE_URL, out, toJpeg);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one download between callers that ask at the same time", async () => {
    const out = path.join(dir, "shared.jpg");
    const image = await makeImage("png");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    safeFetchMock.mockImplementation(async () => {
      await gate;
      return served(image);
    });
    const both = Promise.all([
      ensureLocalImage(IMAGE_URL, out, toJpeg),
      ensureLocalImage(IMAGE_URL, out, toJpeg),
    ]);
    release();
    await both;
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(out)).toBe(true);
  });

  it("leaves no file when the download fails", async () => {
    const out = path.join(dir, "missing.jpg");
    safeFetchMock.mockResolvedValueOnce(served("gone", { status: 404 }));
    await expect(ensureLocalImage(IMAGE_URL, out, toJpeg)).rejects.toThrow(
      RemoteImageError,
    );
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe("small helpers", () => {
  it("urlDigest is stable, 24 hex characters, and differs per URL", () => {
    expect(urlDigest(IMAGE_URL)).toMatch(/^[0-9a-f]{24}$/);
    expect(urlDigest(IMAGE_URL)).toBe(urlDigest(IMAGE_URL));
    expect(urlDigest(IMAGE_URL)).not.toBe(urlDigest(IMAGE_URL + "2"));
  });

  it("imageHost names the host and drops the path and query", () => {
    expect(imageHost(IMAGE_URL)).toBe("images.example.com");
    expect(imageHost("not a url")).toBe("invalid URL");
  });

  it("counts an error it did not classify as transient", () => {
    expect(isTransientImageError(new Error("disk full"))).toBe(true);
  });
});
