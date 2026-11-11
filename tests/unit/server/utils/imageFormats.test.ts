// Unit: the one list of images the server reads, apart from the blocked
// loaders. sharp's prebuilt libvips reads nothing else that the list refuses,
// but a native install can link a libvips with more loaders, and the HEIF
// block goes once sharp ships the libheif fixes, which a test here watches
// for. A test that unblocks a loader blocks it again, because the block holds
// for the process.

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

  describe("AVIF, behind the HEIF block", () => {
    const avif = () =>
      sharp({
        create: { width: 8, height: 8, channels: 3, background: "#006a91" },
      })
        .avif()
        .toBuffer();

    /** True when version `a` is `b` or later, as dotted numbers. */
    const atLeast = (a: string, b: string) => {
      const [x, y] = [a, b].map((v) => v.split(".").map(Number));
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
      }
      return true;
    };

    it("is refused exactly while sharp's libheif predates the 1.23.7 fixes", async () => {
      // A sharp update that bundles libheif 1.23.7 fails here until
      // VipsForeignLoadHeif leaves the block list in imageFormats.ts. Then
      // AVIF reads again, and this passes again.
      const libheif = sharp.versions.heif ?? "0";
      const reads = await assertReadableImage(await avif()).then(
        () => true,
        () => false,
      );
      expect({ libheif, avifReads: reads }).toEqual({
        libheif,
        avifReads: atLeast(libheif, "1.23.7"),
      });
    });

    it("reads with the HEIF loader unblocked", async () => {
      const image = await avif();
      await unblocked("VipsForeignLoadHeif", () =>
        expect(assertReadableImage(image)).resolves.toBeUndefined(),
      );
    });
  });
});
