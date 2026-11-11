/**
 * HEIF photos, made readable in the browser. The server reads no HEIF image
 * (`server/utils/imageFormats.ts`), and an iPhone takes its photos in HEIC, so
 * a HEIF photo becomes a JPEG here before anything is sent: a photo inside an
 * imported vCard, a contact's photo and an account photo.
 *
 * The browser's own decoder goes first: Safari reads HEIC, and every current
 * browser reads AVIF. When it cannot, heic-to loads on demand. It is libheif
 * 1.23.7 and libde265 compiled to JavaScript, and it decodes in a worker, so a
 * flaw in the decoder stays inside that worker's memory. Its CSP build runs no
 * eval and no WebAssembly, so the page's `script-src 'self'` still holds.
 *
 * heic-to runs in a worker this module owns (`heifDecoder.worker.ts`), which
 * is stopped when it is idle, after an error and after a stall, so its memory
 * goes and a decoder that stopped answering is replaced.
 */

import type { DecodeAnswer } from "./heifDecoder.worker";

/** The longer side of a converted photo. Every place shows it far smaller. */
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.9;

/**
 * The `ftyp` brands of a HEIF file: HEIC and its sequences, generic HEIF
 * (`mif1`, `msf1`), and AVIF.
 */
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

/** True when `head`, the first 12 bytes of a file or more, starts a HEIF file. */
export function isHeif(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const word = (at: number) =>
    String.fromCharCode(...head.subarray(at, at + 4));
  return word(4) === "ftyp" && HEIF_BRANDS.has(word(8));
}

/**
 * How long one photo may take in heic-to before its worker is stopped. A 48
 * MP photo takes about 5 seconds on a laptop.
 */
const DECODE_TIMEOUT_MS = 60_000;
/** How long the worker stays after its last photo. Its memory goes with it. */
const IDLE_MS = 30_000;

let decoder: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** One photo at a time: the worker answers in order, with no ids. */
let queue: Promise<unknown> = Promise.resolve();

function stopDecoder(): void {
  clearTimeout(idleTimer);
  decoder?.terminate();
  decoder = null;
}

/** One photo through heic-to, in the worker this module owns. */
function decodeOnce(blob: Blob): Promise<ImageBitmap> {
  clearTimeout(idleTimer);
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("this browser cannot read HEIC photos"));
  }
  const worker = (decoder ??= new Worker(
    new URL("./heifDecoder.worker.ts", import.meta.url),
    { type: "module" },
  ));
  return new Promise((resolve, reject) => {
    const finish = (answer: DecodeAnswer) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      if ("bitmap" in answer) {
        idleTimer = setTimeout(stopDecoder, IDLE_MS);
        resolve(answer.bitmap);
      } else {
        // A fresh worker for the next photo: this one may be stuck or spent.
        stopDecoder();
        reject(new Error(answer.error));
      }
    };
    const timer = setTimeout(
      () => finish({ error: "it took too long to read" }),
      DECODE_TIMEOUT_MS,
    );
    worker.onmessage = (event: MessageEvent<DecodeAnswer>) =>
      finish(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ error: "the photo reader stopped" });
    };
    worker.postMessage(blob);
  });
}

/** The browser's own decoder, then heic-to's. Throws when neither reads it. */
async function decode(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // This browser has no HEIC decoder. heic-to has one.
    }
  }
  const run = queue.then(() => decodeOnce(blob));
  queue = run.catch(() => undefined);
  return run;
}

/** A JPEG of `bitmap`, at most MAX_SIDE on its longer side, on white. */
async function encodeJpeg(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not draw the photo");
  // A JPEG has no transparency: a clear pixel turns white, as on the server.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!jpeg) throw new Error("Could not save the photo as a JPEG");
  return jpeg;
}

/** A JPEG of a HEIF image. Throws when no decoder can read it. */
async function heifToJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await decode(blob);
  try {
    return await encodeJpeg(bitmap);
  } finally {
    bitmap.close();
  }
}

/**
 * The file to send for a chosen photo: a HEIF photo as a JPEG named after it,
 * any other photo as it came. Throws when a HEIF photo cannot be read.
 */
export async function readablePhotoFile(file: File): Promise<File> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!isHeif(head)) return file;
  const jpeg = await heifToJpeg(file);
  const stem = file.name.replace(/\.[^.]*$/, "") || "photo";
  return new File([jpeg], `${stem}.jpg`, { type: "image/jpeg" });
}

const BASE64_DATA_URI = /^data:[^;,]*;base64,/i;

/** The bytes of a base64 data URI, or null when it is not one. */
function dataUriBytes(uri: string, length?: number): Uint8Array | null {
  const prefix = BASE64_DATA_URI.exec(uri)?.[0];
  if (!prefix) return null;
  // 16 base64 characters are the first 12 bytes, enough to tell HEIF.
  const base64 = uri.slice(prefix.length, length && prefix.length + length);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** True when `uri` is a base64 data URI of a HEIF image. */
function isHeifDataUri(uri: string | null | undefined): uri is string {
  if (!uri) return false;
  const head = dataUriBytes(uri, 16);
  return !!head && isHeif(head);
}

/** The media type of HEIF bytes, for a decoder that goes by the type. */
function heifType(bytes: Uint8Array): string {
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return brand.startsWith("avi") ? "image/avif" : "image/heic";
}

/** A data URI of a blob. A data URI is not fetched: the CSP's connect-src has no `data:`. */
function dataUriOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read the photo"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Turn each HEIF photo of an import into a JPEG data URI, in place, one at a
 * time. A photo that will not convert stays as it was: the server cannot read
 * it either, and the import's summary counts it. `onProgress` hears the count
 * before the first photo and after each one. Returns how many photos were HEIF.
 */
export async function convertHeifPhotos(
  contacts: { avatarUrl?: string | null }[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const heif = contacts.filter((c) => isHeifDataUri(c.avatarUrl));
  if (heif.length === 0) return 0;
  onProgress?.(0, heif.length);
  let done = 0;
  for (const contact of heif) {
    const bytes = dataUriBytes(contact.avatarUrl!);
    if (bytes) {
      try {
        const blob = new Blob([bytes as BlobPart], { type: heifType(bytes) });
        const jpeg = await heifToJpeg(blob);
        contact.avatarUrl = await dataUriOf(jpeg);
      } catch {
        // Left as it was. The server refuses it, and the summary counts it.
      }
    }
    done += 1;
    onProgress?.(done, heif.length);
  }
  return heif.length;
}
