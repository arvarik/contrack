// Ways to narrow a long answer. A question made only of facets, such as "Who do
// I track?", can find thousands, and Ask lists the first 30 by name. These are
// the facets that split the whole list: tracking, its most common industries,
// cities, companies and tags, and a recent contact. A press asks again with the
// facet added. Each count comes from the facet SQL the search runs
// (`compileFacets`), so a chip's number is the narrowed answer's total. A text
// facet matches part of a value ("Fintech" finds "Fintech Infrastructure"), so
// grouped counts only pick the values, and each is counted again, all in one
// pass over the list.

import { sqlite } from "../../db.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { FacetFilter } from "../../../shared/searchFacets.ts";
import { formatFacet, type RefineOption } from "../../../shared/facetQuery.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { compileFacets } from "./facetSql.ts";

/** The most options a long answer offers. */
const MAX_OPTIONS = 6;

interface Candidate {
  filter: FacetFilter;
  label: string;
}

/**
 * The facets that split an answer's whole list, at most six, each with the
 * number of people it keeps. A facet that keeps everyone, or fewer than two,
 * is left out, so a value the question already asks for never comes back.
 */
export function refineOptions(
  scope: Scope,
  filters: FacetFilter[],
  total: number,
): RefineOption[] {
  const base = compileFacets(scope, filters);
  const matching = `${ACTIVE_CONTACT_SQL} AND (${base.sql})`;
  const params = [scope.ownerId, ...base.params];

  /**
   * The most common values of a text field among the list's people. A value
   * the question asks for keeps everyone, so the field reads one more value
   * for each filter on it.
   */
  const common = (
    field: "industry" | "location" | "company" | "tag",
    limit: number,
    value: string,
    join = "",
  ): Candidate[] =>
    (
      sqlite
        .prepare(
          `SELECT ${value} AS value FROM contacts c ${join}
            WHERE c.ownerId = ? AND ${matching} AND trim(COALESCE(${value}, '')) != ''
            GROUP BY lower(${value}) ORDER BY COUNT(DISTINCT c.id) DESC, value LIMIT ?`,
        )
        .all(
          ...params,
          limit + filters.filter((f) => f.field === field).length,
        ) as { value: string }[]
    ).map((row) => ({ filter: { field, value: row.value }, label: row.value }));

  // Each kind: the most options it gives, and its candidates in order.
  const kinds: [number, Candidate[]][] = [
    [1, [{ filter: { field: "tracked", value: "yes" }, label: "Tracked" }]],
    [2, common("industry", 2, "c.industry")],
    // The city is what comes before the first comma.
    [
      2,
      common(
        "location",
        2,
        "trim(substr(c.location, 1, instr(c.location || ',', ',') - 1))",
      ),
    ],
    [1, common("company", 1, "c.company")],
    [2, common("tag", 2, "t.tag", "JOIN contact_tags t ON t.contactId = c.id")],
    [
      1,
      [
        {
          filter: { field: "contacted", value: "30d", operator: "<" },
          label: "Contacted in 30 days",
        },
      ],
    ],
  ];
  const candidates = kinds.flatMap(([limit, list], at) =>
    list.map((candidate) => ({ ...candidate, limit, at })),
  );
  const compiled = candidates.map(({ filter }) =>
    compileFacets(scope, [filter]),
  );
  const counts = sqlite
    .prepare(
      `SELECT ${compiled.map(({ sql }) => `SUM(CASE WHEN ${sql} THEN 1 ELSE 0 END)`).join(", ")}
        FROM contacts c WHERE c.ownerId = ? AND ${matching}`,
    )
    .raw()
    .get(...compiled.flatMap((facet) => facet.params), ...params) as (
    number | null
  )[];

  // Each kind's first option comes before any kind's second, so a long
  // answer offers a range of ways to narrow it. They show in kind order.
  const ranks = kinds.map(() => 0);
  return candidates
    .flatMap(({ filter, label, limit, at }, i) => {
      const count = counts[i] ?? 0;
      if (count < 2 || count >= total || ranks[at]! >= limit) return [];
      const option = { facet: formatFacet(filter), label, count };
      return [{ option, at, rank: ranks[at]!++ }];
    })
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, MAX_OPTIONS)
    .sort((a, b) => a.at - b.at || a.rank - b.rank)
    .map(({ option }) => option);
}
