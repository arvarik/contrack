/**
 * Facet tokens in a search query, as pure data.
 *
 * GitHub-style filters: role:founder, company:stripe, location:london,
 * industry:fintech, tag:investor, score:>80, updated:>6m, contacted:>90d,
 * missing:email, list:investors, near:London/50km, tracked:yes.
 *
 * The palette's tokenizer hook (`src/hooks/useQueryTokenizer.ts`) and the
 * server's Ask pipeline read facets with the same code, so a question typed
 * into either one means the same thing.
 *
 * @module shared/facetQuery
 */
import {
  FACET_FIELDS,
  type FacetField,
  type FacetFilter,
} from "./searchFacets.ts";

const FIELDS: ReadonlySet<string> = new Set(FACET_FIELDS);

/** The field names as one regular-expression alternation. */
export const FACET_FIELD_PATTERN = FACET_FIELDS.join("|");

/** Parse a raw value string into a structured filter, handling operators for score/updated/contacted and near distance */
export function parseFilterValue(
  field: FacetField,
  rawValue: string,
): FacetFilter | null {
  if (!rawValue) return null;

  if (field === "score") {
    const opMatch = rawValue.match(/^([><]?)(\d+)$/);
    if (!opMatch) return null;
    return {
      field,
      value: opMatch[2],
      operator: (opMatch[1] as ">" | "<") || ">",
    };
  }

  if (field === "updated" || field === "contacted") {
    if (field === "contacted" && /^never$/i.test(rawValue))
      return { field, value: "never" };
    const opMatch = rawValue.match(/^([><]?)(\d+[dwmy])$/i);
    if (!opMatch) return null;
    return {
      field,
      value: opMatch[2],
      operator: (opMatch[1] as ">" | "<") || ">",
    };
  }

  if (field === "near") {
    const match = rawValue.match(/^([^/]+)(?:\/(\d+)(?:km)?)?$/i);
    if (!match) return null;
    const place = match[1].trim();
    const km = match[2] ? parseInt(match[2], 10) : 25;
    return {
      field,
      value: place,
      km,
    };
  }

  return { field, value: rawValue };
}

/**
 * Split a query into its facet filters and its free text.
 *
 * The palette's hook treats a facet at the end of the input with no space
 * after it as one still being typed, so the autocomplete can open. A query
 * that arrives whole, from a link like `/?q=tracked:no`, from the Inbox's
 * `/?q=missing:company` or from the Ask box, has no typist, so here a
 * trailing facet is a facet. A field the value parser rejects (`score:abc`)
 * stays in the free text.
 */
export function parseFacetQuery(input: string): {
  freeText: string;
  filters: FacetFilter[];
} {
  const filters: FacetFilter[] = [];
  const words = input.split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  for (const word of words) {
    const match = word.match(/^([a-z]+):(.+)$/i);
    const field = match?.[1].toLowerCase();
    if (match && field && FIELDS.has(field)) {
      const filter = parseFilterValue(field as FacetField, match[2]);
      if (filter) {
        if (
          !filters.some(
            (f) => f.field === filter.field && f.value === filter.value,
          )
        ) {
          filters.push(filter);
        }
        continue;
      }
    }
    rest.push(word);
  }
  return { freeText: rest.join(" "), filters };
}
