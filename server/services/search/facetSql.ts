// Facets as SQL. Each facet becomes a predicate on the contacts row, alias `c`,
// so the FTS statement, the approximate-name step and the vector KNN apply it
// before their LIMIT, and no filtered contact is lost to a cut. The server and
// the palette must agree on every row, so the SQL calls the palette's own
// JavaScript: `facet_contains` is `matchesFacet`'s lower-casing and substring
// test, `facet_time` its date reading, and `haversine_km` `shared/geo.ts`.
// `tests/unit/server/search/facetSql.test.ts` compares the two facet by facet.

import type Database from "better-sqlite3";
import { sqlite } from "../../db.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { haversineKm } from "../../../shared/geo.ts";
import {
  facetCutoff,
  facetNeedle,
  facetTime,
  type FacetFilter,
} from "../../../shared/searchFacets.ts";

/** A facet predicate over the alias `c` and the values it binds, in order. */
export interface CompiledFacets {
  sql: string;
  params: unknown[];
}

/**
 * The characters JavaScript's `trim()` removes. SQLite's `trim()` removes
 * spaces only, so `missing:` passes this set to match `matchesFacet`.
 */
const JS_WHITESPACE = "\t\n\v\f\r                  　﻿";

/** The mean Earth radius `haversineKm` uses. */
const EARTH_KM = 6371;

/**
 * Register the SQL functions a compiled facet calls. Idempotent: SQLite
 * replaces a function registered again under the same name and arity.
 */
export function registerFacetFunctions(db: Database.Database): void {
  db.function(
    "facet_contains",
    { deterministic: true },
    (haystack: unknown, needle: unknown) =>
      typeof haystack === "string" &&
      typeof needle === "string" &&
      haystack.toLowerCase().includes(needle)
        ? 1
        : 0,
  );
  db.function("facet_time", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? facetTime(value) : null,
  );
  db.function(
    "haversine_km",
    { deterministic: true },
    (lat: unknown, lng: unknown, toLat: unknown, toLng: unknown) =>
      haversineKm(
        { lat: Number(lat), lng: Number(lng) },
        { lat: Number(toLat), lng: Number(toLng) },
      ),
  );
}

registerFacetFunctions(sqlite);

/** A predicate that holds for no row. */
const NONE = "0";

/** The score `contactScore` shows: tracked, an interaction logged, rounded. */
const SHOWN_SCORE =
  "CASE WHEN COALESCE(c.isTracked, 0) != 0 AND COALESCE(c.lastContactedAt, '') != '' THEN round(min(100, max(0, c.relationshipScore))) END";

/** The contacts columns the four text facets read. */
const TEXT_COLUMNS = {
  role: "c.role",
  company: "c.company",
  location: "c.location",
  industry: "c.industry",
} as const;

/**
 * The ids of the owner's lists a `list:` value names: by id, by name, or by
 * the name with its spaces as dashes, compared the way `matchesFacet` does.
 */
function listIds(scope: Scope, filter: FacetFilter): string[] {
  const needle = facetNeedle(filter);
  const lists = sqlite
    .prepare("SELECT id, name FROM lists WHERE ownerId = ?")
    .all(scope.ownerId) as { id: string; name: string }[];
  return lists
    .filter(
      (list) =>
        list.id === filter.value ||
        list.name.toLowerCase() === needle ||
        list.name.toLowerCase().replace(/\s+/g, "-") === needle,
    )
    .map((list) => list.id);
}

/**
 * `near:` as a box the index can check, then the exact distance. The box bounds
 * the circle on `haversineKm`'s sphere with a small margin, so it never drops a
 * contact the distance keeps. When the circle reaches a pole or the 180th
 * meridian, the longitude bound goes and the distance alone decides.
 */
function nearSql(filter: FacetFilter, params: unknown[]): string {
  // Without a point it matches everyone, as in `matchesFacet`.
  if (!filter.point) return "1";
  const { lat, lng, km } = filter.point;
  if (![lat, lng, km].every(Number.isFinite)) return NONE;
  const radians = km / EARTH_KM + 1e-6;
  const latRad = (lat * Math.PI) / 180;
  const degrees = (value: number) => (value * 180) / Math.PI;
  const parts = [
    "typeof(c.lat) IN ('integer', 'real')",
    "typeof(c.lng) IN ('integer', 'real')",
    "c.lat BETWEEN -90 AND 90",
    "c.lng BETWEEN -180 AND 180",
    "c.lat BETWEEN ? AND ?",
  ];
  params.push(degrees(latRad - radians), degrees(latRad + radians));
  if (latRad - radians > -Math.PI / 2 && latRad + radians < Math.PI / 2) {
    const spread = degrees(Math.asin(Math.sin(radians) / Math.cos(latRad)));
    if (lng - spread >= -180 && lng + spread <= 180) {
      parts.push("c.lng BETWEEN ? AND ?");
      params.push(lng - spread, lng + spread);
    }
  }
  parts.push("haversine_km(c.lat, c.lng, ?, ?) <= ?");
  params.push(lat, lng, km);
  return parts.join(" AND ");
}

/** One facet as a predicate. Its values are appended to `params`. */
function facetSql(
  scope: Scope,
  filter: FacetFilter,
  params: unknown[],
): string {
  const needle = facetNeedle(filter);
  switch (filter.field) {
    case "role":
    case "company":
    case "location":
    case "industry":
      params.push(needle);
      return `facet_contains(${TEXT_COLUMNS[filter.field]}, ?)`;
    case "tag":
      params.push(needle);
      return "EXISTS (SELECT 1 FROM contact_tags t WHERE t.contactId = c.id AND facet_contains(t.tag, ?))";
    case "score": {
      const threshold = parseInt(filter.value, 10);
      if (Number.isNaN(threshold)) return NONE;
      params.push(threshold);
      return (filter.operator || ">") === ">"
        ? `${SHOWN_SCORE} >= ?`
        : `${SHOWN_SCORE} <= ?`;
    }
    case "tracked":
      if (needle === "yes" || needle === "true" || needle === "1")
        return "COALESCE(c.isTracked, 0) != 0";
      if (needle === "no" || needle === "false" || needle === "0")
        return "COALESCE(c.isTracked, 0) = 0";
      return NONE;
    case "updated":
    case "added": {
      const cutoff = facetCutoff(filter.value);
      if (!cutoff) return NONE;
      params.push(cutoff.getTime());
      const column = filter.field === "added" ? "c.addedAt" : "c.updatedAt";
      return (filter.operator || ">") === ">"
        ? `facet_time(${column}) < ?`
        : `facet_time(${column}) >= ?`;
    }
    case "contacted": {
      if (needle === "never") return "facet_time(c.lastContactedAt) IS NULL";
      const cutoff = facetCutoff(filter.value);
      if (!cutoff) return NONE;
      params.push(cutoff.getTime());
      return (filter.operator || ">") === ">"
        ? "(facet_time(c.lastContactedAt) IS NULL OR facet_time(c.lastContactedAt) < ?)"
        : "facet_time(c.lastContactedAt) >= ?";
    }
    case "missing":
      switch (needle) {
        case "company":
        case "location":
          params.push(JS_WHITESPACE);
          return `c.${needle} IS NULL OR trim(c.${needle}, ?) = ''`;
        case "email":
          params.push(JS_WHITESPACE);
          return "NOT EXISTS (SELECT 1 FROM contact_emails e WHERE e.contactId = c.id AND e.email IS NOT NULL AND trim(e.email, ?) != '')";
        case "phone":
          params.push(JS_WHITESPACE);
          return "NOT EXISTS (SELECT 1 FROM contact_phones p WHERE p.contactId = c.id AND p.phone IS NOT NULL AND trim(p.phone, ?) != '')";
        default:
          return NONE;
      }
    case "list": {
      const ids = listIds(scope, filter);
      if (!ids.length) return NONE;
      params.push(JSON.stringify(ids));
      return "EXISTS (SELECT 1 FROM list_members lm WHERE lm.contactId = c.id AND lm.listId IN (SELECT value FROM json_each(?)))";
    }
    case "near":
      return nearSql(filter, params);
    default:
      return "1";
  }
}

/**
 * Compile facets into one predicate over the contacts alias `c`. Every facet
 * must hold, as in the palette. No facets gives "1". A facet that can match
 * nobody, such as `list:` with a name the owner has no list for, gives "0", as
 * `matchesFacet` gives false.
 */
export function compileFacets(
  scope: Scope,
  filters: FacetFilter[],
): CompiledFacets {
  const params: unknown[] = [];
  const clauses = filters.map(
    (filter) => `(${facetSql(scope, filter, params)})`,
  );
  return { sql: clauses.length ? clauses.join(" AND ") : "1", params };
}

/**
 * One stable key for a set of facets, for the Ask cache. Two requests that
 * carry the same facets in another order, or once typed and once sent as a
 * pill, share it.
 */
export function facetKey(filters: FacetFilter[]): string {
  if (!filters.length) return "";
  const keys = filters.map((filter) =>
    JSON.stringify([
      filter.field,
      filter.value.toLowerCase(),
      filter.operator ?? "",
      filter.point
        ? [filter.point.lat, filter.point.lng, filter.point.km]
        : null,
    ]),
  );
  return [...new Set(keys)].sort().join("|");
}
