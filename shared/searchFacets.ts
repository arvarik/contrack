import { z } from "zod";
import { parseServerTime } from "./dates.ts";
import { haversineKm, isValidLatLng } from "./geo.ts";
import { contactScore } from "./scoreBand.ts";

export type FacetField =
  | "role"
  | "company"
  | "location"
  | "industry"
  | "tag"
  | "score"
  | "updated"
  | "contacted"
  | "missing"
  | "list"
  | "near"
  | "tracked";

/** Every facet field, in the order the palette documents them. */
export const FACET_FIELDS = [
  "role",
  "company",
  "location",
  "industry",
  "tag",
  "score",
  "updated",
  "contacted",
  "missing",
  "list",
  "near",
  "tracked",
] as const satisfies readonly FacetField[];

export interface FacetFilter {
  field: FacetField;
  value: string;
  /** For score:, updated: and contacted: operators (e.g., >80, <40, >90d) */
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
  lastContactedAt?: string | null;
  emails?: { email: string }[];
  phones?: { phone: string }[];
  lists?: { id: string; name: string }[];
  lat?: number | null;
  lng?: number | null;
}

/**
 * The facets a search request may carry, as `GET /api/search` and
 * `POST /api/search/semantic` accept them: at most 8. A `near:` facet
 * carries its resolved `point`. Fields the palette keeps for itself, such as
 * `resolving`, are dropped.
 */
export const facetFiltersSchema = z
  .array(
    z.object({
      field: z.enum(FACET_FIELDS),
      value: z.string().trim().min(1).max(100),
      operator: z.enum([">", "<"]).optional(),
      km: z.number().positive().max(20_000).optional(),
      point: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          km: z.number().positive().max(20_000),
        })
        .optional(),
    }),
  )
  .max(8);

/**
 * The value a text facet looks for: lower case, one pair of quotes removed.
 * `compileFacets` on the server passes the same string to its SQL.
 */
export function facetNeedle(filter: FacetFilter): string {
  return filter.value.toLowerCase().replace(/^["']|["']$/g, "");
}

/** Match a facet filter against a SlimSearchContact */
export function matchesFacet(
  contact: FacetContact,
  filter: FacetFilter,
): boolean {
  const v = facetNeedle(filter);

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
      // The score the card shows: a tracked contact with an interaction logged.
      return matchesScoreFilter(
        contactScore({
          isTracked: contact.isTracked ?? false,
          relationshipScore: contact.relationshipScore,
          lastContactedAt: contact.lastContactedAt,
        }),
        filter,
      );
    case "tracked":
      return matchesTrackedFilter(contact.isTracked ?? false, v);
    case "updated":
      return matchesDateFilter(contact.updatedAt ?? null, filter);
    case "contacted":
      return matchesContactedFilter(contact.lastContactedAt ?? null, filter);
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

/**
 * The moment a duration value points back to: "3m" is 90 days before now,
 * counted in days on the local calendar. Null when the value is not a
 * whole number followed by d, w, m or y.
 */
export function facetCutoff(value: string, now = new Date()): Date | null {
  const match = value.match(/^(\d+)([dwmy])$/i);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const daysMap: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
  const days = amount * (daysMap[unit] ?? 30);

  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - days);
  return cutoffDate;
}

/**
 * A stored timestamp as a moment, or null. `parseServerTime` reads each
 * form the columns hold, and `compileFacets` registers the same reading as
 * a SQL function, so the server and the client agree on every row.
 */
export function facetTime(value: string | null | undefined): number | null {
  return parseServerTime(value)?.getTime() ?? null;
}

/** Date comparison: updated:>3m (older than 3 months), updated:<1m (newer than 1 month) */
function matchesDateFilter(
  dateStr: string | null,
  filter: FacetFilter,
): boolean {
  const cutoffDate = facetCutoff(filter.value);
  const contactDate = facetTime(dateStr);
  if (cutoffDate === null || contactDate === null) return false;
  const op = filter.operator || ">";

  // "updated:>3m" means "last updated MORE than 3 months ago" (older)
  return op === ">"
    ? contactDate < cutoffDate.getTime()
    : contactDate >= cutoffDate.getTime();
}

/**
 * Last contact: `contacted:>90d` is more than 90 days ago or never,
 * `contacted:<30d` is within the last 30 days, and `contacted:never` is
 * never. A date that cannot be read counts as never.
 */
function matchesContactedFilter(
  lastContactedAt: string | null,
  filter: FacetFilter,
): boolean {
  const last = facetTime(lastContactedAt);
  if (filter.value.toLowerCase() === "never") return last === null;
  const cutoffDate = facetCutoff(filter.value);
  if (cutoffDate === null) return false;
  return (filter.operator || ">") === ">"
    ? last === null || last < cutoffDate.getTime()
    : last !== null && last >= cutoffDate.getTime();
}
