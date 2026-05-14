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
