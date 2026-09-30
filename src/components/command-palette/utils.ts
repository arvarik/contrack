import type { ZeroStateInsight } from "../../types";

export function getMode(search: string): "normal" | "action" | "ai" {
  const trimmed = search.trim();
  if (trimmed.startsWith("?")) return "ai";
  if (trimmed.startsWith(">")) return "action";
  return "normal";
}

/**
 * Where a zero-state insight leads, or null when it has nowhere to go.
 *
 * A count opens the page that lists what it counts. Stale data opens the
 * People list already filtered to those contacts, the address the Pulse
 * inbox row uses. It once opened Settings, which lists no contact at all.
 * A catch-up or a ghost names one contact, and opens that contact.
 */
export function insightPath(insight: ZeroStateInsight): string | null {
  switch (insight.type) {
    case "action_items":
      return "/pulse";
    case "stale_data":
      return "/?q=updated:>6m";
    case "dedupe":
      return "/pulse/duplicates";
    default:
      return insight.contact ? `/contact/${insight.contact.id}` : null;
  }
}

/** cmdk group heading style — reused across all Command.Group instances */
const GROUP_HEADING =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em]";

/**
 * The palette's current row: the selected-row look (the `row-selected`
 * utility in index.css), the primary tint. cmdk marks the current row with
 * `aria-selected`, so the utility
 * takes that variant. Text that was `text-primary` on the row takes
 * `aria-selected:text-on-primary-wash`.
 */
export const ITEM_CURRENT = "aria-selected:row-selected";

/**
 * The badge after a result's name: "Approximate". Give it its tone's wash
 * (`TONE_WASH`). The palette and the Ask page's result cards both use it.
 * A result AI did not verify wears an orange question mark instead.
 */
export const MATCH_BADGE =
  "text-[11px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded shrink-0";

/**
 * True when no exact answer, model or filter proved this result, so it
 * wears the orange "Not verified by AI" question mark. An older server
 * sends no `verified`, and then the chunk's `fallback` decides, as it did
 * before.
 */
export function isUnverified(
  match: { verified?: boolean },
  fallback: boolean,
): boolean {
  return match.verified === false || (match.verified === undefined && fallback);
}

/** Group heading color variants */
export const GROUP_HEADING_DEFAULT = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-on-surface-variant`;
export const GROUP_HEADING_PRIMARY = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-primary`;
export const GROUP_HEADING_EMERALD = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-success`;

/** Strip the mode prefix from a search query for display purposes */
export function stripModePrefix(query: string): string {
  return query.replace(/^[?>]\s*/, "").trim();
}
