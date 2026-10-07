import type { ZeroStateInsight } from "../../types";

export function getMode(search: string): "normal" | "action" | "ai" {
  const trimmed = search.trim();
  if (trimmed.startsWith("?")) return "ai";
  if (trimmed.startsWith(">")) return "action";
  return "normal";
}

/**
 * Where a zero-state insight leads, or null. A count opens the page that
 * lists it. Stale data opens the People list filtered to those contacts. A
 * catch-up or a ghost opens its contact.
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
 * The palette's current row: `row-selected` (index.css) on the row cmdk
 * marks `aria-selected`. Its text takes `aria-selected:text-on-primary-wash`.
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
 * wears the orange "Not verified by AI" mark. Without `verified`, the
 * chunk's `fallback` decides.
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

/**
 * The heading over the palette's AI results. A question of facets alone can
 * find thousands, and the list stops at 30, so a cut list says how many.
 */
export function aiResultsHeading(
  fallback: boolean,
  shown: number,
  total: number,
  /** AI is set up. Without it, rules answered, and the heading says so. */
  ai = true,
): string {
  const heading = fallback ? "Not verified by AI" : ai ? "AI answer" : "Answer";
  return total > shown
    ? `${heading} · ${shown} of ${total.toLocaleString()}`
    : heading;
}

/**
 * The words read as a question: "who works at Stripe", "list investors?".
 * The people search then offers no new contact by that name.
 */
export const looksLikeQuestion = (words: string): boolean =>
  /^(who|whom|whose|what|which|where|when|why|how|list|find|show)\b|\?$/i.test(
    words.trim(),
  );
