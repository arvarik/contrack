// Brotli or gzip for the answers that gain from it. An instance reached over
// the internet with no compressing proxy would otherwise send the starter
// question pool (28 KB of JSON), the slim contact list (6 MB for a network of
// 5,824 contacts) and the built JS and CSS at full size.
//
// The `compression` package answers with brotli when the client takes it, else
// gzip, else the plain body, and sets `Vary: Accept-Encoding` on every answer
// it could have compressed. It already leaves alone a HEAD request, a
// `Cache-Control: no-transform` response, a body with a Content-Encoding and a
// type that is not text. `shouldCompress` adds the two rules this app needs.
// Mounted in server/app.ts before anything that can answer (see there).

import compression from "compression";
import zlib from "zlib";
import type { Request, Response } from "express";

/**
 * Below this many bytes a body goes out as it is. The saving there is less than
 * the headers every answer carries (about 840 bytes, nearly half of it the
 * CSP), and it arrives in the first round trip either way. The health check,
 * the auth status and a production error envelope are under it; the starter
 * pool goes from 28 KB to 4 KB. 1 KB is the package's own default.
 */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * Bodies a route writes, and the browser must read, a piece at a time.
 *
 * A compressor holds input until it has enough, so a compressed stream would
 * arrive in lumps, the last at the end: Ask's instant local list would arrive
 * with the final answer, and the duplicate scan, research and the import would
 * show no progress until done. Flushing after each write would need every
 * stream route to call `res.flush()`. Uncompressed, Ask's final line is 25 to
 * 28 KB on a network of 5,824 contacts, small next to the 6 MB slim list.
 *
 * Both entries matter: `compressible` counts every `text/*` type, so
 * `text/event-stream` would be compressed without this rule, and only the
 * absence of `application/x-ndjson` from its database spares the Ask stream,
 * which a new release could change. The MCP SDK marks its own event streams
 * `no-transform` as well.
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
 * True when a response may be compressed. Runs once, when the response starts,
 * so it sees every header set.
 * 1. Never a stream (see `STREAMED_TYPES`).
 * 2. Never the answer to a byte range: `Content-Range` counts the stored bytes,
 *    and a compressed body would corrupt a resumed download.
 * 3. Otherwise the package's rule: a type the MIME database marks compressible.
 *    JSON, HTML, JS, CSS, SVG and plain text are; JPEG, PNG, WebP, AVIF, GIF
 *    and WOFF2 are compressed already.
 */
export function shouldCompress(req: Request, res: Response): boolean {
  if (STREAMED_TYPES.has(mediaTypeOf(res))) return false;
  if (req.headers.range !== undefined || res.statusCode === 206) return false;
  return compression.filter(req, res);
}

/**
 * The middleware. Brotli quality 4 and gzip level 6 are the package's and
 * zlib's defaults, written out so an upgrade cannot change them unseen.
 * Brotli's maximum, 11, which zlib uses when nothing is set, is for build-time
 * files: on the 6 MB slim list it took 4.8 s where quality 4 took 17 ms, for a
 * body 25 percent smaller. Quality 4 beats gzip by 16 percent in half the time.
 */
export const compressResponses = compression({
  threshold: COMPRESSION_THRESHOLD_BYTES,
  filter: shouldCompress,
  level: 6,
  brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
});
