export type FacetField =
  "role" | "company" | "location" | "industry" | "tag" | "score" | "updated";

export interface FacetFilter {
  field: FacetField;
  value: string;
  /** For score: and updated: operators (e.g., >80, <40) */
  operator?: ">" | "<";
}

interface FacetContact {
  role?: string | null;
  company?: string | null;
  location?: string | null;
  industry?: string | null;
  tags?: { tag: string }[];
  relationshipScore?: number | null;
  updatedAt?: string | null;
}

/** Match a facet filter against a SlimSearchContact */
export function matchesFacet(
  contact: FacetContact,
  filter: FacetFilter,
): boolean {
  const v = filter.value.toLowerCase();

  switch (filter.field) {
    case "role":
      return contact.role?.toLowerCase().includes(v) ?? false;
    case "company":
      return contact.company?.toLowerCase().includes(v) ?? false;
    case "location":
      return contact.location?.toLowerCase().includes(v) ?? false;
    case "industry":
      return contact.industry?.toLowerCase().includes(v) ?? false;
    case "tag":
      return (contact.tags ?? []).some((t) => t.tag.toLowerCase().includes(v));
    case "score":
      return matchesScoreFilter(contact.relationshipScore ?? null, filter);
    case "updated":
      return matchesDateFilter(contact.updatedAt ?? null, filter);
    default:
      return true;
  }
}

/** Score comparison: score:>80, score:<40 */
function matchesScoreFilter(
  score: number | null,
  filter: FacetFilter,
): boolean {
  if (score === null || score === undefined) return false;
  const threshold = parseInt(filter.value, 10);
  if (isNaN(threshold)) return false;

  const op = filter.operator || ">";
  return op === ">" ? score >= threshold : score <= threshold;
}

/** Date comparison: updated:>3m (older than 3 months), updated:<1m (newer than 1 month) */
function matchesDateFilter(
  dateStr: string | null,
  filter: FacetFilter,
): boolean {
  if (!dateStr) return false;

  const match = filter.value.match(/^(\d+)([dwmy])$/i);
  if (!match) return false;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const daysMap: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
  const days = amount * (daysMap[unit] ?? 30);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const contactDate = new Date(dateStr);
  const op = filter.operator || ">";

  // "updated:>3m" means "last updated MORE than 3 months ago" (older)
  return op === ">" ? contactDate < cutoffDate : contactDate >= cutoffDate;
}
