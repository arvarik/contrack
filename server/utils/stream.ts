import type { Response } from "express";

/** The two kinds of stream the server writes. Neither is ever compressed. */
export type StreamType = "text/event-stream" | "application/x-ndjson";

/**
 * Start a streamed response: its type, no caching and no proxy buffering. The
 * headers go out at once, so each line leaves when it is written.
 * `X-Accel-Buffering: no` stops nginx from holding the body until its buffer
 * fills, which would deliver an import's or a scan's progress in lumps.
 */
export function startStream(res: Response, type: StreamType): void {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}
