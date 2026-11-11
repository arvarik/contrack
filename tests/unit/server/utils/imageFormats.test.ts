// Unit: the one list of images the server reads, apart from the blocked
// loaders. sharp's prebuilt libvips reads nothing else that the list refuses,
// but a native install can link a libvips with more loaders, and the HEIF
// block goes once sharp ships the libheif fixes. Each test unblocks a loader
// for itself and blocks it again, because the block holds for the process.

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertReadableImage } from "../../../../server/utils/imageFormats.ts";

/** Run `check` with one loader unblocked, then block it again. */
async function unblocked(operation: string, check: () => Promise<void>) {
  sharp.unblock({ operation: [operation] });
  try {
    await check();
  } finally {
    sharp.block({ operation: [operation] });
  }
}

describe("assertReadableImage", () => {
  it("refuses an SVG by its format where the SVG loader reads it", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
    );
    await expect(assertReadableImage(svg)).rejects.toThrow("Not an image");
    await unblocked("VipsForeignLoadSvg", () =>
      expect(assertReadableImage(svg)).rejects.toThrow(
        'Refusing image format "svg"',
      ),
    );
  });

  it("reads an AVIF once the HEIF loader is unblocked", async () => {
    const avif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#006a91" },
    })
      .avif()
      .toBuffer();
    await expect(assertReadableImage(avif)).rejects.toThrow("Not an image");
    await unblocked("VipsForeignLoadHeif", () =>
      expect(assertReadableImage(avif)).resolves.toBeUndefined(),
    );
  });
});
