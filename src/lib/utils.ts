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
 * A LinkedIn slug without the suffix LinkedIn adds when a person has set no
 * custom URL, for display: "rowan-vale-07993773" shows "rowan-vale". The
 * last hyphenated part goes when it has 5 or more letters and digits with at
 * least one digit, so an initial such as "-c" stays. A slug with no hyphen
 * is a custom one and stays as it is.
 */
export function cleanLinkedInSlug(slug: string): string {
  const lastDash = slug.lastIndexOf("-");
  if (lastDash === -1) return slug;

  const suffix = slug.slice(lastDash + 1);

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
