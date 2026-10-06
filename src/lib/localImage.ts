/**
 * True when `url` is a same-origin upload path, `/uploads/...`. The server
 * stores link-preview images there, but an older note can hold the linked
 * site's own URL, and loading it would tell that site each time. A
 * protocol-relative or absolute URL fails, and the caller draws a
 * placeholder.
 */
export function isLocalUploadUrl(url: unknown): url is string {
  return typeof url === "string" && url.startsWith("/uploads/");
}
