/**
 * Shared frontend utilities — small, framework-agnostic helpers that don't
 * belong to a specific feature directory.
 *
 * @module src/lib/utils
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine class names with Tailwind-aware conflict resolution.
 *
 * Wraps {@link https://github.com/lukeed/clsx | clsx} (truthy filtering of
 * conditional class fragments) and pipes the result through
 * {@link https://github.com/dcastil/tailwind-merge | tailwind-merge} so that
 * later utility classes win over earlier conflicting ones, e.g.
 * `cn("p-2", isLarge && "p-6")` resolves to `"p-6"` instead of `"p-2 p-6"`.
 *
 * Prefer `cn` over hand-stitching className strings whenever the result
 * contains:
 *   - Conditional Tailwind utilities (toggled by props or state)
 *   - A base layer that callers may want to override
 *   - Variant-style class composition (e.g. button "tone" + "size" tables)
 *
 * @param inputs - Any mix of strings, falsy values, arrays, and objects
 *   accepted by `clsx`. See clsx's docs for the full grammar.
 * @returns A single space-separated className string with Tailwind conflicts
 *   resolved in favor of later entries.
 *
 * @example
 * ```ts
 * cn("rounded-xl bg-surface", isActive && "bg-primary text-on-primary")
 * // → "rounded-xl bg-primary text-on-primary" when isActive
 * ```
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Escape a string for safe interpolation into an HTML string.
 *
 * Escapes the five characters with special meaning in HTML markup and
 * attribute values: `&`, `<`, `>`, `"`, `'`. Use whenever untrusted data is
 * concatenated into raw HTML (e.g. Leaflet divIcon templates).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * LinkedIn slug cleanup — strips auto-generated numeric suffixes for display.
 *
 * LinkedIn auto-generates slugs like "alex-sadler-07993773" when a user
 * hasn't set a custom vanity URL. The suffix is alphanumeric (hex/numeric)
 * and typically 5-10 characters. We strip it for cleaner display while
 * keeping the actual URL unchanged.
 *
 * Heuristic:
 *   1. The slug must contain at least one hyphen (multi-part = name segments)
 *   2. The last segment must be ≥5 chars (avoids stripping real name initials like "-c")
 *   3. The last segment must contain at least one digit (names rarely do)
 *
 * Examples:
 *   "alex-sadler-07993773"      → "alex-sadler"
 *   "alexander-glavin-17b821a8" → "alexander-glavin"
 *   "yuxuan-jonathan-c-027b18156" → "yuxuan-jonathan-c"
 *   "young-lee-78ab07111"       → "young-lee"
 *   "aayush1196"                → "aayush1196"    (no hyphens → no change)
 *   "wangxi05104"               → "wangxi05104"   (no hyphens → no change)
 */
export function cleanLinkedInSlug(slug: string): string {
  const lastDash = slug.lastIndexOf("-");
  if (lastDash === -1) return slug; // no hyphens → custom username, leave untouched

  const suffix = slug.slice(lastDash + 1);

  // Only strip if the suffix is ≥5 chars and contains at least one digit
  if (suffix.length >= 5 && /\d/.test(suffix) && /^[a-z0-9]+$/i.test(suffix)) {
    return slug.slice(0, lastDash);
  }

  return slug;
}

/** URL schemes considered safe for anchor hrefs. */
const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Validate a URL for use as an anchor `href`.
 *
 * Returns the URL unchanged when it is a relative path (starts with `/`) or
 * an absolute URL with an `http:`, `https:`, `mailto:`, or `tel:` scheme.
 * Returns `undefined` for anything else (`javascript:`, `data:`, `vbscript:`,
 * unparseable input, null/empty) so the anchor renders without an href.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return url;
  try {
    const parsed = new URL(trimmed);
    if (SAFE_HREF_SCHEMES.has(parsed.protocol.toLowerCase())) return url;
  } catch {
    // Not an absolute URL and not a rooted relative path — reject.
  }
  return undefined;
}
