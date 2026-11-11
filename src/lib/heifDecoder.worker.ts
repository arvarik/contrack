/**
 * Decodes one HEIF photo with heic-to, for `src/lib/heifPhoto.ts`, which owns
 * this worker and stops it when it is idle, after an error and after a stall.
 * heic-to keeps a decoder of its own for the life of its module, in a worker
 * that grows its memory to the largest photo and never gives it back: one 48
 * MP photo held over a gigabyte until the page closed. Stopping this worker
 * stops that one too.
 *
 * heic-to loads on the first photo, as its own chunk, so the page fetches it
 * only when a photo needs it.
 */

import { errorText } from "./utils";

/** The answer to one photo: its pixels, or why there are none. */
export type DecodeAnswer = { bitmap: ImageBitmap } | { error: string };

/**
 * The text of a decode failure. heic-to's worker answers with the error's
 * text, "Error: HEIF processing error", and with nothing when it cannot start.
 */
function failureText(err: unknown): string {
  const text = errorText(err, err ? String(err) : "");
  return text.replace(/^Error:\s*/, "") || "no decoder could read it";
}

self.onmessage = async (event: MessageEvent<Blob>) => {
  let answer: DecodeAnswer;
  try {
    const { heicTo } = await import("heic-to/csp");
    answer = { bitmap: await heicTo({ blob: event.data, type: "bitmap" }) };
  } catch (err) {
    answer = { error: failureText(err) };
  }
  self.postMessage(answer, {
    transfer: "bitmap" in answer ? [answer.bitmap] : [],
  });
};
