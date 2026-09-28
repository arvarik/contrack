// =============================================================================
// Remote images — fetched once by the server, never by the browser
// =============================================================================
// Company logos, Google contact photos and link-preview images all start as a
// URL on somebody else's server. A browser that loads such a URL tells that
// server who looked, when, and from where. So the server fetches each image
// at most once, checks that it is a raster image, re-encodes it, and keeps
// the result on disk. The browser only ever sees the local copy.
//
// Re-encoding is the point, not a side effect. The bytes that reach disk are
// pixels sharp decoded and wrote again, so nothing the remote server put in
// the file (metadata, a polyglot payload, an SVG script) survives the trip.
//
// Failures come in two kinds, because the logo cache treats them differently:
//   permanent  The server answered, and the answer was no: a 4xx, a body that
//              is not a raster image, or a body over the size cap. Asking
//              again gives the same answer.
//   transient  No usable answer: the network is down, the request timed out,
//              or the server failed (5xx, 408, 429). Asking later can work.
// =============================================================================

import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp, { type Metadata, type Sharp } from "sharp";
import { AppError, UpstreamTimeoutError, ValidationError } from "./AppError.ts";
import { ensureDir } from "./paths.ts";
import { RequestCoalescer } from "./requestCoalescer.ts";
import {
  UNRESOLVABLE_HOST_MESSAGE,
  readBytesCapped,
  safeFetch,
} from "./urlSafety.ts";

export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_IMAGE_TIMEOUT_MS = 8_000;

/**
 * The formats sharp reports that we accept: the same raster set as
 * RASTER_MIME_ALLOWLIST in avatarProcessor.ts. SVG is refused on purpose, as
 * there: it can carry scripts. The check reads the bytes, never the
 * Content-Type header, which the remote server controls.
 */
const RASTER_FORMATS = new Set(["jpeg", "png", "gif", "webp"]);

/** An image fetch or re-encode that failed, and whether to try it again. */
export class RemoteImageError extends AppError {
  readonly transient: boolean;

  constructor(message: string, transient: boolean, cause?: unknown) {
    super(message, 502, {
      code: transient ? "REMOTE_IMAGE_UNAVAILABLE" : "REMOTE_IMAGE_REFUSED",
      cause,
    });
    this.transient = transient;
  }
}

/**
 * True when a failure says nothing about the image itself.
 *
 * An error this module did not classify (a full disk, a bug) counts as
 * transient. A cache that records a permanent miss for the wrong reason
 * hides a logo for 30 days, and a wrongly transient one costs one retry.
 */
export function isTransientImageError(err: unknown): boolean {
  if (err instanceof RemoteImageError) return err.transient;
  return true;
}

/** A stable 24-hex-character file name stem for a remote URL. */
export function urlDigest(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
}

/**
 * The host of a URL, for log lines.
 *
 * Photo and image URLs often carry an access token in the path or the query
 * string, so a log line names the host and nothing more.
 */
export function imageHost(url: string): string {
  try {
    return new URL(url).host || "unknown host";
  } catch {
    return "invalid URL";
  }
}

export interface FetchImageOptions {
  /** Refuse a body larger than this. Default 5 MB. */
  maxBytes?: number;
  /** The budget for the whole download, headers and body. Default 8 s. */
  timeoutMs?: number;
  /** The caller's cancellation. An abort is rethrown as it is, unwrapped. */
  signal?: AbortSignal;
}

/**
 * Download one image through the SSRF-guarded fetch, and return its bytes
 * once they are known to be a raster image.
 *
 * Throws RemoteImageError for every failure except the caller's own abort,
 * which is rethrown with its original reason so the caller can stop.
 */
export async function fetchRemoteImage(
  url: string,
  options: FetchImageOptions = {},
): Promise<Buffer> {
  const {
    maxBytes = DEFAULT_MAX_IMAGE_BYTES,
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    signal,
  } = options;
  signal?.throwIfAborted();

  // One deadline for the whole download. safeFetch's own timer stops when
  // the headers arrive, and the body read has a timer of its own, so without
  // this a slow server could take both budgets back to back.
  const deadline = AbortSignal.timeout(timeoutMs);
  const budget = signal ? AbortSignal.any([deadline, signal]) : deadline;

  let response: globalThis.Response;
  try {
    ({ response } = await safeFetch(url, {
      timeoutMs,
      maxRedirects: 3,
      signal: budget,
    }));
  } catch (err) {
    throw classifyFetchError(err, signal);
  }

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    const status = response.status;
    const transient = status >= 500 || status === 408 || status === 429;
    throw new RemoteImageError(`Image request answered ${status}`, transient);
  }

  // A declared length over the cap is refused before a single byte is read.
  // The capped reader still enforces the cap, because the header is a claim.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new RemoteImageError(`Image is larger than ${maxBytes} bytes`, false);
  }

  let body: Buffer;
  try {
    body = await readBytesCapped(response, maxBytes, budget, timeoutMs);
  } catch (err) {
    if (err instanceof AppError && err.code === "RESPONSE_TOO_LARGE") {
      throw new RemoteImageError(
        `Image is larger than ${maxBytes} bytes`,
        false,
        err,
      );
    }
    throw classifyFetchError(err, signal);
  }

  await assertRasterImage(body);
  return body;
}

/** Sort a failure before the body arrived into permanent or transient. */
function classifyFetchError(err: unknown, signal?: AbortSignal): unknown {
  // The caller cancelled. That is not a fact about the image, and the
  // caller needs to see its own reason to stop.
  if (signal?.aborted) return signal.reason ?? err;
  if (err instanceof RemoteImageError) return err;
  if (err instanceof ValidationError) {
    // A name that does not resolve is usually the network. Every other
    // ValidationError from safeFetch is a URL the guard refuses (a private
    // address, a scheme other than http(s)), and that answer never changes.
    const transient = err.message === UNRESOLVABLE_HOST_MESSAGE;
    return new RemoteImageError(err.message, transient, err);
  }
  if (err instanceof UpstreamTimeoutError) {
    return new RemoteImageError("Image download timed out", true, err);
  }
  if (err instanceof AppError) {
    // safeFetch's only other AppError is a redirect chain over the limit.
    return new RemoteImageError(err.message, false, err);
  }
  // A network failure, a DNS failure at connect time, or the deadline.
  const message =
    err instanceof Error && err.name === "TimeoutError"
      ? "Image download timed out"
      : "Image download failed";
  return new RemoteImageError(message, true, err);
}

/**
 * Refuse anything that is not a JPEG, PNG, GIF, WebP or AVIF image.
 *
 * sharp reads only the header here and decodes no pixels. The decode happens
 * in the writer, under sharp's default `limitInputPixels`, which is what
 * refuses a decompression bomb.
 */
export async function assertRasterImage(body: Buffer): Promise<void> {
  let meta: Metadata;
  try {
    meta = await sharp(body).metadata();
  } catch (err) {
    throw new RemoteImageError("Response is not an image", false, err);
  }
  // sharp reports AVIF as "heif" with AV1 compression. HEIF with any other
  // codec (the HEVC in a phone's .heic) is not on the list.
  const allowed =
    RASTER_FORMATS.has(meta.format ?? "") ||
    (meta.format === "heif" && meta.compression === "av1");
  if (!allowed) {
    throw new RemoteImageError(
      `Refusing image format "${meta.format ?? "unknown"}"`,
      false,
    );
  }
}

/**
 * Re-encode an image and write it to `outPath` atomically.
 *
 * `pipeline` receives a sharp instance for the input and returns it with the
 * resize and output format applied. A decode or encode failure is a
 * permanent RemoteImageError. A file system failure is rethrown unwrapped,
 * and so counts as transient.
 */
export async function writeImageAtomically(
  input: Buffer,
  outPath: string,
  pipeline: (image: Sharp) => Sharp,
): Promise<void> {
  let encoded: Buffer;
  try {
    encoded = await pipeline(sharp(input)).toBuffer();
  } catch (err) {
    throw new RemoteImageError("Image could not be decoded", false, err);
  }
  await writeFileAtomically(outPath, encoded);
}

/**
 * Write a file so that a reader sees either no file or the complete file.
 *
 * The bytes go to a temporary file in the same folder, and a rename puts it
 * in place. A rename inside one file system is atomic, so a crash halfway
 * through leaves a stray temporary file, never half an image under the real
 * name that every later request would take for a finished cache entry. The
 * temporary name starts with a dot, which express.static does not serve.
 */
export async function writeFileAtomically(
  outPath: string,
  data: Buffer | string,
): Promise<void> {
  const dir = path.dirname(outPath);
  ensureDir(dir);
  const temp = path.join(
    dir,
    `.${path.basename(outPath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await fs.promises.writeFile(temp, data);
    await fs.promises.rename(temp, outPath);
  } catch (err) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** One download per output file, however many callers ask at once. */
const localCopies = new RequestCoalescer();

/**
 * Make sure `outPath` holds a local, re-encoded copy of the image at `url`.
 *
 * The file name is expected to come from the URL (see urlDigest), so an
 * existing file IS the finished copy and is reused with no network call.
 * Callers that ask for the same file at the same time share one download.
 * Throws RemoteImageError on failure, or the caller's abort reason.
 */
export async function ensureLocalImage(
  url: string,
  outPath: string,
  pipeline: (image: Sharp) => Sharp,
  options: FetchImageOptions = {},
): Promise<void> {
  if (fs.existsSync(outPath)) return;
  const { signal, ...fetchOptions } = options;
  await localCopies.coalesce(
    outPath,
    async (shared) => {
      // Another flight may have finished between the check and this one.
      if (fs.existsSync(outPath)) return;
      const body = await fetchRemoteImage(url, {
        ...fetchOptions,
        signal: shared,
      });
      await writeImageAtomically(body, outPath, pipeline);
    },
    signal,
  );
}
