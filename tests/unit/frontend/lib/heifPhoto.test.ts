// @vitest-environment jsdom
// Unit: which photos the browser turns from HEIF into JPEG before it sends
// them. The server reads no HEIF image, so a HEIF photo inside an import that
// the browser cannot read either stays as it was, and the server counts it in
// the summary. The decode itself runs in a real browser in
// tests/e2e/heic-photos.spec.ts: jsdom has no image decoder and no canvas.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { heicTo } = vi.hoisted(() => ({ heicTo: vi.fn() }));
vi.mock("heic-to/csp", () => ({ heicTo }));

import {
  convertHeifPhotos,
  isHeif,
  readablePhotoFile,
} from "../../../../src/lib/heifPhoto";

/** A synthetic 96 by 64 HEIC, the format an iPhone takes. */
const HEIC = readFileSync(
  path.resolve(import.meta.dirname, "../../../fixtures/images/photo.heic"),
);

/** The first 12 bytes of a file with this `ftyp` brand. */
const head = (brand: string, box = "ftyp") =>
  new Uint8Array([0, 0, 0, 24, ...Buffer.from(box + brand)]);

afterEach(() => {
  heicTo.mockReset();
});

describe("isHeif", () => {
  it.each(["heic", "heix", "hevc", "mif1", "msf1", "avif"])(
    "reads the %s brand as HEIF",
    (brand) => {
      expect(isHeif(head(brand))).toBe(true);
    },
  );

  it.each<[string, Uint8Array]>([
    [
      "a JPEG",
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]),
    ],
    ["an MP4 video", head("isom")],
    ["a brand outside a ftyp box", head("heic", "moov")],
    ["fewer than 12 bytes", head("heic").subarray(0, 11)],
  ])("does not read %s as HEIF", (_label, bytes) => {
    expect(isHeif(bytes)).toBe(false);
  });

  it("reads the synthetic iPhone photo as HEIF", () => {
    expect(isHeif(HEIC.subarray(0, 12))).toBe(true);
  });
});

describe("readablePhotoFile", () => {
  it("sends any other photo as it came, without loading the decoder", async () => {
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13])],
      "me.png",
      {
        type: "image/png",
      },
    );
    expect(await readablePhotoFile(png)).toBe(png);
    expect(heicTo).not.toHaveBeenCalled();
  });
});

describe("convertHeifPhotos", () => {
  it("leaves a HEIF photo no decoder reads, and every other photo, as it was", async () => {
    heicTo.mockRejectedValue("Error: HEIF image not found");
    const heic = `data:image/heic;base64,${HEIC.toString("base64")}`;
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    const contacts = [
      { avatarUrl: heic },
      { avatarUrl: jpeg },
      { avatarUrl: "https://photos.example.com/a.jpg" },
      { avatarUrl: null },
      {},
    ];
    const progress: [number, number][] = [];

    const found = await convertHeifPhotos(contacts, (done, total) =>
      progress.push([done, total]),
    );

    expect(found).toBe(1);
    expect(progress).toEqual([
      [0, 1],
      [1, 1],
    ]);
    // jsdom has no createImageBitmap, so the decoder was asked, and it failed.
    expect(heicTo).toHaveBeenCalledTimes(1);
    expect(contacts.map((c) => c.avatarUrl)).toEqual([
      heic,
      jpeg,
      "https://photos.example.com/a.jpg",
      null,
      undefined,
    ]);
  });

  it("does nothing for an import with no HEIF photo", async () => {
    const onProgress = vi.fn();
    expect(
      await convertHeifPhotos(
        [{ avatarUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" }],
        onProgress,
      ),
    ).toBe(0);
    expect(onProgress).not.toHaveBeenCalled();
    expect(heicTo).not.toHaveBeenCalled();
  });
});
