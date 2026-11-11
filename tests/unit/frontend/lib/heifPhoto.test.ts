// @vitest-environment jsdom
// Unit: which photos the browser turns from HEIF into JPEG before it sends
// them. The server reads no HEIF image, and the browser's own decoder does the
// turning, so a HEIF photo the browser cannot read is refused with a word on
// what to do, and one inside an import stays as it was, for the server to
// count on the summary. The decode itself runs in a real browser in
// tests/e2e/heif-photos.spec.ts: jsdom has no image decoder and no canvas, so
// a stand-in for createImageBitmap answers here.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertHeifPhotos,
  isHeif,
  readablePhotoFile,
} from "../../../../src/lib/heifPhoto";

/** A synthetic 96 by 64 HEIC, the format an iPhone takes. */
const HEIC = readFileSync(
  path.resolve(import.meta.dirname, "../../../fixtures/images/photo.heic"),
);
const HEIC_URI = `data:image/heic;base64,${HEIC.toString("base64")}`;

/** The first 12 bytes of a file with this `ftyp` brand. */
const head = (brand: string, box = "ftyp") =>
  new Uint8Array([0, 0, 0, 24, ...Buffer.from(box + brand)]);

/** A browser whose decoder cannot read the photo, as Chrome with a HEIC. */
function noDecoder() {
  const decode = vi
    .fn()
    .mockRejectedValue(new DOMException("", "InvalidStateError"));
  vi.stubGlobal("createImageBitmap", decode);
  return decode;
}

afterEach(() => {
  vi.unstubAllGlobals();
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
  it("sends any other photo as it came, without decoding it", async () => {
    const decode = noDecoder();
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13])],
      "me.png",
      { type: "image/png" },
    );
    expect(await readablePhotoFile(png)).toBe(png);
    expect(decode).not.toHaveBeenCalled();
  });

  it("refuses a HEIC photo the browser cannot read, and says what to do", async () => {
    noDecoder();
    const heic = new File([HEIC], "IMG_0001.HEIC", { type: "image/heic" });
    await expect(readablePhotoFile(heic)).rejects.toThrow(
      "Choose a JPEG, or use Safari, which reads HEIC",
    );
  });
});

describe("convertHeifPhotos", () => {
  it("leaves a HEIF photo the browser cannot read, and every other photo, as it was", async () => {
    const decode = noDecoder();
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    const contacts = [
      { avatarUrl: HEIC_URI },
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
    expect(decode).toHaveBeenCalledTimes(1);
    expect(contacts.map((c) => c.avatarUrl)).toEqual([
      HEIC_URI,
      jpeg,
      "https://photos.example.com/a.jpg",
      null,
      undefined,
    ]);
  });

  it("leaves the photos after the one it was cancelled at as they were", async () => {
    const decode = noDecoder();
    let asked = 0;

    await convertHeifPhotos(
      [
        { avatarUrl: HEIC_URI },
        { avatarUrl: HEIC_URI },
        { avatarUrl: HEIC_URI },
      ],
      undefined,
      () => ++asked > 1,
    );

    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an import with no HEIF photo", async () => {
    const decode = noDecoder();
    const onProgress = vi.fn();
    expect(
      await convertHeifPhotos(
        [{ avatarUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" }],
        onProgress,
      ),
    ).toBe(0);
    expect(onProgress).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });
});
