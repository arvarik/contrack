// =============================================================================
// Ways to narrow a long answer
// =============================================================================
// A question made only of facets, such as "Who do I track?", can find
// thousands, and Ask lists the first 30 by name. Here are the facets that
// split the whole list: tracking, its most common industries, cities,
// companies and tags, and a recent contact. A press asks the question again
// with the facet added.
//
// Each count comes from the facet SQL the search runs (`compileFacets`), so a
// chip's number is the narrowed answer's own total. A text facet matches a
// part of a value ("Fintech" also finds "Fintech Infrastructure"), so the
// grouped counts only choose the values, and each one is counted again.
// =============================================================================

import { sqlite } from "../../db.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { FacetFilter } from "../../../shared/searchFacets.ts";
import { formatFacet, type RefineOption } from "../../../shared/facetQuery.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { compileFacets } from "./facetSql.ts";

/** The most options a long answer offers. */
const MAX_OPTIONS = 6;

/**
 * The facets that split an answer's whole list, at most six, each with the
 * number of people it keeps. A facet that keeps everyone, or one person, is
 * left out, and so is a field the question already filters on.
 */
export function refineOptions(
  scope: Scope,
  filters: FacetFilter[],
  total: number,
): RefineOption[] {
  const base = compileFacets(scope, filters);
  const matching = `${ACTIVE_CONTACT_SQL} AND (${base.sql})`;
  const params = [scope.ownerId, ...base.params];
  const filtered = (field: FacetFilter["field"]) =>
    filters.some((filter) => filter.field === field);
  /** The most common values of one text column among the list's people. */
  const top = (value: string, limit: number) =>
    (
      sqlite
        .prepare(
          `SELECT ${value} AS value FROM contacts c
            WHERE c.ownerId = ? AND ${matching} AND trim(COALESCE(${value}, '')) != ''
            GROUP BY lower(${value}) ORDER BY COUNT(*) DESC, value LIMIT ?`,
        )
        .all(...params, limit) as { value: string }[]
    ).map((row) => row.value);

  const candidates: { filter: FacetFilter; label: string }[] = [];
  if (!filtered("tracked"))
    candidates.push({
      filter: { field: "tracked", value: "yes" },
      label: "Tracked",
    });
  for (const [field, value, limit] of [
    ["industry", "c.industry", 2],
    // The city is what comes before the first comma.
    [
      "location",
      "trim(substr(c.location, 1, instr(c.location || ',', ',') - 1))",
      2,
    ],
    ["company", "c.company", 1],
  ] as const) {
    if (filtered(field)) continue;
    for (const label of top(value, limit))
      candidates.push({ filter: { field, value: label }, label });
  }
  const tagged = new Set(
    filters.filter((f) => f.field === "tag").map((f) => f.value.toLowerCase()),
  );
  const tags = (
    sqlite
      .prepare(
        `SELECT t.tag AS value FROM contact_tags t JOIN contacts c ON c.id = t.contactId
          WHERE c.ownerId = ? AND ${matching}
          GROUP BY lower(t.tag) ORDER BY COUNT(DISTINCT c.id) DESC, value LIMIT ?`,
      )
      .all(...params, tagged.size + 2) as { value: string }[]
  ).map((row) => row.value);
  for (const tag of tags
    .filter((t) => !tagged.has(t.toLowerCase()))
    .slice(0, 2))
    candidates.push({ filter: { field: "tag", value: tag }, label: tag });
  if (!filtered("contacted"))
    candidates.push({
      filter: { field: "contacted", value: "30d", operator: "<" },
      label: "Contacted in 30 days",
    });

  const options: RefineOption[] = [];
  for (const { filter, label } of candidates) {
    const extra = compileFacets(scope, [filter]);
    const { n } = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM contacts c
          WHERE c.ownerId = ? AND ${matching} AND (${extra.sql})`,
      )
      .get(...params, ...extra.params) as { n: number };
    if (n >= 2 && n < total)
      options.push({ facet: formatFacet(filter), label, count: n });
    if (options.length === MAX_OPTIONS) break;
  }
  return options;
}
