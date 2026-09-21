import { haversineKm, isValidLatLng } from "./geo";

export type FacetField =
  | "role"
  | "company"
  | "location"
  | "industry"
  | "tag"
  | "score"
  | "updated"
  | "missing"
  | "list"
  | "near"
  | "tracked";

export interface FacetFilter {
  field: FacetField;
  value: string;
  /** For score: and updated: operators (e.g., >80, <40) */
  operator?: ">" | "<";
  /** Distance in kilometers for near: filter (default 25) */
  km?: number;
  /** Resolved geospatial point for near: filter */
  point?: { lat: number; lng: number; km: number };
  /** True while near: filter is resolving coordinates */
  resolving?: boolean;
  /** Error message if near: resolution failed */
  error?: string;
}

export interface FacetContact {
  role?: string | null;
  company?: string | null;
  location?: string | null;
  industry?: string | null;
  tags?: ({ tag: string } | string)[];
  relationshipScore?: number | null;
  /** A person chose to keep up with this contact. */
  isTracked?: boolean;
  updatedAt?: string | null;
  emails?: { email: string }[];
  phones?: { phone: string }[];
  lists?: { id: string; name: string }[];
  lat?: number | null;
  lng?: number | null;
}

/** Match a facet filter against a SlimSearchContact */
export function matchesFacet(
  contact: FacetContact,
  filter: FacetFilter,
): boolean {
  const v = filter.value.toLowerCase().replace(/^["']|["']$/g, "");

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
      return (contact.tags ?? []).some((t) =>
        (typeof t === "string" ? t : t.tag).toLowerCase().includes(v),
      );
    case "score":
      return matchesScoreFilter(contact.relationshipScore ?? null, filter);
    case "tracked":
      return matchesTrackedFilter(contact.isTracked ?? false, v);
    case "updated":
      return matchesDateFilter(contact.updatedAt ?? null, filter);
    case "missing":
      return matchesMissingFilter(contact, v);
    case "list": {
      if (!contact.lists || contact.lists.length === 0) return false;
      return contact.lists.some(
        (l) =>
          l.id === filter.value ||
          l.name.toLowerCase() === v ||
          l.name.toLowerCase().replace(/\s+/g, "-") === v,
      );
    }
    case "near": {
      // Without a point it matches everyone and the pill says "resolving…"
      if (!filter.point) return true;
      if (!isValidLatLng(contact.lat, contact.lng)) return false;
      return (
        haversineKm(
          { lat: contact.lat as number, lng: contact.lng as number },
          filter.point,
        ) <= filter.point.km
      );
    }
    default:
      return true;
  }
}

/**
 * Tracked check: `tracked:yes` for the people a person keeps up with,
 * `tracked:no` for everyone else. Any other value matches nobody, so a typo
 * shows an empty list rather than the whole one.
 */
function matchesTrackedFilter(isTracked: boolean, value: string): boolean {
  if (value === "yes" || value === "true" || value === "1") return isTracked;
  if (value === "no" || value === "false" || value === "0") return !isTracked;
  return false;
}

/** Missing field check: missing:company, missing:location, missing:email, missing:phone */
function matchesMissingFilter(contact: FacetContact, field: string): boolean {
  switch (field) {
    case "company":
      return !contact.company || contact.company.trim() === "";
    case "location":
      return !contact.location || contact.location.trim() === "";
    case "email":
      return (
        !contact.emails ||
        contact.emails.length === 0 ||
        contact.emails.every((e) => !e.email || e.email.trim() === "")
      );
    case "phone":
      return (
        !contact.phones ||
        contact.phones.length === 0 ||
        contact.phones.every((p) => !p.phone || p.phone.trim() === "")
      );
    default:
      return false;
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
