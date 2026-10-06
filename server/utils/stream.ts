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

/**
 * A signal that aborts when the client disconnects before the response ends,
 * so the work behind a request stops with it. Call `release` once the work is
 * done. `onDisconnect`, for a log line, runs on every close.
 */
export function abortOnDisconnect(
  res: Response,
  onDisconnect?: () => void,
): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const onClose = () => {
    onDisconnect?.();
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);
  return {
    signal: controller.signal,
    release: () => res.off("close", onClose),
  };
}

/** True when `err` is the abort of work whose client went away. */
export function isClientAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}
