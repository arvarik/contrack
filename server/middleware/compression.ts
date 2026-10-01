// =============================================================================
// Compression — brotli or gzip for the answers that gain from it
// =============================================================================
// The server sent every body as it was. On localhost that costs nothing. An
// instance reached over the internet with no compressing proxy in front sent
// the starter question pool (28 KB of JSON), the slim contact list (6 MB for
// a real network of 5,824 contacts) and the built JS and CSS at full size.
//
// The `compression` package reads the request's Accept-Encoding and answers
// with brotli when the client takes it, else gzip, else the body as it is. It
// sets `Vary: Accept-Encoding` on every answer it could have compressed, so a
// cache keeps one copy per encoding. On its own it already leaves alone a
// HEAD request, a response marked `Cache-Control: no-transform`, a body that
// already has a Content-Encoding, and a type that is not text: a photo, a
// font, an archive. `shouldCompress` adds the two rules this app needs.
//
// Mounted in server/app.ts before anything that can answer. See there for
// why the place matters.
// =============================================================================

import compression from "compression";
import zlib from "zlib";
import type { Request, Response } from "express";

/**
 * Below this many bytes a body goes out as it is.
 *
 * The saving there is a few hundred bytes, less than the headers that every
 * answer carries (about 840 bytes, nearly half of it the CSP), and the answer
 * arrives in the first round trip either way. The health check, the auth
 * status and an error envelope in production are under it. Above it the
 * gain grows with the body: the starter pool goes from 28 KB to 4 KB. 1 KB
 * is also the package's own default.
 */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * Bodies that a route writes a piece at a time, and that the browser must
 * read a piece at a time.
 *
 * A compressor holds its input until it has enough to compress well, so a
 * compressed stream reaches the browser in lumps, the last one at the end.
 * Ask Contrack's first line, the instant local list, would arrive with the
 * final answer, and the duplicate scan, contact research and the import
 * would show no progress until they were done. The package can flush after a
 * write, but only when the route calls `res.flush()` every time, and every
 * stream route would have to remember to. The cost of leaving streams alone
 * is their size: on a real network of 5,824 contacts, Ask's final line was
 * 25 to 28 KB, small next to the 6 MB slim list.
 *
 * Both entries matter. `compressible` counts every `text/*` type as
 * compressible, so `text/event-stream` would be compressed without this rule.
 * It does not list `application/x-ndjson`, which is the only reason the Ask
 * stream would not be, and a new release of its database could change that.
 * The MCP SDK marks its own event streams `no-transform` as well.
 */
const STREAMED_TYPES = new Set(["text/event-stream", "application/x-ndjson"]);

/** The response's media type, lowercase, without parameters. */
function mediaTypeOf(res: Response): string {
  const header = res.getHeader("Content-Type");
  const value = Array.isArray(header) ? header[0] : header;
  return String(value ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

/**
 * True when a response may be compressed. Runs once, when the response
 * starts, so it sees the headers every route and middleware set.
 *
 * 1. Never a stream (see `STREAMED_TYPES`).
 * 2. Never the answer to a byte range. `Content-Range` counts the bytes of
 *    the file as it is stored, and a compressed body would not match it, so a
 *    resumed download of an attachment would come out corrupt.
 * 3. Otherwise the package's own rule: a type that the MIME database marks
 *    compressible. JSON, HTML, JS, CSS, SVG and plain text are. JPEG, PNG,
 *    WebP, AVIF, GIF and WOFF2 are not, because they are compressed already.
 */
export function shouldCompress(req: Request, res: Response): boolean {
  if (STREAMED_TYPES.has(mediaTypeOf(res))) return false;
  if (req.headers.range !== undefined || res.statusCode === 206) return false;
  return compression.filter(req, res);
}

/**
 * The middleware.
 *
 * Brotli at quality 4 and gzip at level 6 are the package's and zlib's own
 * defaults, written out so an upgrade cannot change them unseen. Brotli's
 * maximum, 11, is what zlib uses when nothing is set, and it is meant for
 * files compressed once at build time: on the slim list of 5,824 contacts
 * (6 MB of JSON) it took 4.8 seconds where quality 4 took 17 ms, for a body
 * 25 percent smaller. Quality 4 made that list 16 percent smaller than gzip
 * did, in half the time.
 */
export const compressResponses = compression({
  threshold: COMPRESSION_THRESHOLD_BYTES,
  filter: shouldCompress,
  level: 6,
  brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
});
