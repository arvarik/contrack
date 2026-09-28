/**
 * True when `url` is a same-origin upload path: `/uploads/...`.
 *
 * The server downloads link-preview images and stores them under the
 * caller's uploads, so a current preview always carries such a path. A note
 * saved before that change can still hold the linked site's own image URL,
 * and loading it would tell that site each time the note is opened. Code
 * that draws a server-fetched image checks with this first, and draws a
 * placeholder for anything else.
 *
 * The path starts with one slash and a fixed segment, so a protocol-relative
 * URL (`//host/...`) or any absolute URL fails the check.
 */
export function isLocalUploadUrl(url: unknown): url is string {
  return typeof url === "string" && url.startsWith("/uploads/");
}
