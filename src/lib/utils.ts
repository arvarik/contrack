/** Small frontend helpers that belong to no feature folder. */
import { twMerge, type ClassNameValue } from "tailwind-merge";

/**
 * Joins class names and drops falsy ones. A later Tailwind class wins over an
 * earlier one that conflicts: `cn("p-2", isLarge && "p-6")` is `"p-6"`.
 */
export function cn(...inputs: ClassNameValue[]): string {
  return twMerge(...inputs);
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

/**
 * A count with its noun: `plural(1, "contact", "contacts")` is "1 contact",
 * and every other count takes the plural.
 */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The words of a thrown error for a toast: its message without a period at
 * the end, because a toast is a statement and has none.
 *
 * @param fallback - What to say for a thrown value that is not an Error.
 *   Without one, the value as text.
 */
export function errorText(err: unknown, fallback?: string): string {
  return err instanceof Error
    ? err.message.replace(/\.$/, "")
    : (fallback ?? String(err));
}
