// @vitest-environment jsdom
// Unit: which photos the browser turns from HEIF into JPEG before it sends
// them, and the worker heic-to decodes in. The server reads no HEIF image, so
// a HEIF photo inside an import that the browser cannot read either stays as
// it was, and the server counts it in the summary. The decode itself runs in a
// real browser in tests/e2e/heic-photos.spec.ts: jsdom has no image decoder,
// no canvas and no Worker, so a stand-in answers for the worker here.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecodeAnswer } from "../../../../src/lib/heifDecoder.worker";

/** A stand-in for the decoder worker, which answers each photo as told. */
class FakeWorker {
  static made: FakeWorker[] = [];
  /** What the next worker answers: a bitmap, an error, or nothing at all. */
  static answer: () => DecodeAnswer | null = () => ({
    error: "HEIF processing error",
  });
  onmessage: ((event: { data: DecodeAnswer }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  photos = 0;
  terminated = false;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage() {
    this.photos += 1;
    const answer = FakeWorker.answer();
    if (answer) queueMicrotask(() => this.onmessage?.({ data: answer }));
  }
  terminate() {
    this.terminated = true;
  }
}

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

beforeEach(() => {
  FakeWorker.made = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
    expect(FakeWorker.made).toEqual([]);
  });
});

describe("convertHeifPhotos", () => {
  it("leaves a HEIF photo no decoder reads, and every other photo, as it was", async () => {
    FakeWorker.answer = () => ({ error: "HEIF processing error" });
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
    // jsdom has no createImageBitmap, so the worker was asked, and it failed.
    // A worker that failed is stopped, so the next photo gets a fresh one.
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]).toMatchObject({ photos: 1, terminated: true });
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
    expect(FakeWorker.made).toEqual([]);
  });

  it("leaves the photos after the one it was cancelled at as they were", async () => {
    FakeWorker.answer = () => ({ error: "HEIF processing error" });
    const heic = `data:image/heic;base64,${HEIC.toString("base64")}`;
    let asked = 0;

    await convertHeifPhotos(
      [{ avatarUrl: heic }, { avatarUrl: heic }, { avatarUrl: heic }],
      undefined,
      () => ++asked > 1,
    );

    expect(FakeWorker.made.map((w) => w.photos)).toEqual([1]);
  });

  it("stops a worker that never answers, and gives the next photo a fresh one", async () => {
    vi.useFakeTimers();
    FakeWorker.answer = () => null;
    const heic = `data:image/heic;base64,${HEIC.toString("base64")}`;
    const contacts = [{ avatarUrl: heic }, { avatarUrl: heic }];

    const converting = convertHeifPhotos(contacts);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await converting).toBe(2);
    expect(contacts.map((c) => c.avatarUrl)).toEqual([heic, heic]);
    expect(FakeWorker.made).toHaveLength(2);
    expect(FakeWorker.made.map((w) => w.terminated)).toEqual([true, true]);
  });

  it("stops the worker once it has been idle, which frees its memory", async () => {
    vi.useFakeTimers();
    const bitmap = { width: 8, height: 8, close: vi.fn() };
    FakeWorker.answer = () => ({ bitmap: bitmap as unknown as ImageBitmap });
    const heic = `data:image/heic;base64,${HEIC.toString("base64")}`;

    // jsdom has no canvas, so the JPEG is never written, but the worker
    // answered and stays for the next photo.
    await convertHeifPhotos([{ avatarUrl: heic }]);
    expect(bitmap.close).toHaveBeenCalled();
    expect(FakeWorker.made[0]!.terminated).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWorker.made[0]!.terminated).toBe(true);
  });
});
