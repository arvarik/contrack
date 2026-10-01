// =============================================================================
// Streamed responses
// =============================================================================

import type { Response } from "express";

/** The two kinds of stream the server writes. Neither is ever compressed. */
export type StreamType = "text/event-stream" | "application/x-ndjson";

/**
 * Start a streamed response: its type, no caching and no buffering by a
 * proxy. The headers go out at once, so each line leaves when it is written.
 *
 * `X-Accel-Buffering: no` stops nginx from holding the body until its buffer
 * fills. Without it, the progress of an import or a duplicate scan arrived
 * in lumps behind a proxy with default buffering.
 */
export function startStream(res: Response, type: StreamType): void {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}
