export function getMode(search: string): "normal" | "action" | "ai" {
  const trimmed = search.trim();
  if (trimmed.startsWith("?")) return "ai";
  if (trimmed.startsWith(">")) return "action";
  return "normal";
}

export const EXAMPLE_QUERIES = [
  "Who do I know in London working in FinTech?",
  "Who likes espresso?",
  "Who haven't I contacted in over 3 months?",
  "Who works at a startup as a designer?",
];

/** cmdk group heading style — reused across all Command.Group instances */
export const GROUP_HEADING =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em]";

/**
 * The palette's current row: the selected-row look (the `row-selected`
 * utility in index.css), the primary tint with a 3 px bar on the leading
 * edge. cmdk marks the current row with `aria-selected`, so the utility
 * takes that variant. Text that was `text-primary` on the row takes
 * `aria-selected:text-on-primary-wash`.
 */
export const ITEM_CURRENT = "aria-selected:row-selected";

/**
 * The badge after a result's name: "Approximate", "Keyword" or "Fallback".
 * Give it its tone's wash (`TONE_WASH`). The palette and the Ask page's
 * result cards both use it.
 */
export const MATCH_BADGE =
  "text-[11px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded shrink-0";

/** Group heading color variants */
export const GROUP_HEADING_DEFAULT = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-on-surface-variant`;
export const GROUP_HEADING_PRIMARY = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-primary`;
export const GROUP_HEADING_EMERALD = `${GROUP_HEADING} [&_[cmdk-group-heading]]:text-success`;

/** Strip the mode prefix from a search query for display purposes */
export function stripModePrefix(query: string): string {
  return query.replace(/^[?>]\s*/, "").trim();
}
