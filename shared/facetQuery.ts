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

/**
 * A value with a space goes in double quotes, `industry:"Venture Capital"`,
 * so one word of the query holds all of it. Text may follow the closing
 * quote, as in `near:"San Francisco"/50km`.
 */
export const QUOTED_VALUE_PATTERN = `"[^"]*"\\S*`;

/** The value without its first pair of double quotes. */
function unquote(value: string): string {
  return value.replace(/^"([^"]*)"/, "$1");
}

/** Parse a raw value string into a structured filter, handling operators for score/updated/contacted and near distance */
export function parseFilterValue(
  field: FacetField,
  quotedValue: string,
): FacetFilter | null {
  // The pill and the server read `Venture Capital`, not the quotes.
  const rawValue = unquote(quotedValue);
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
  // A quoted facet value is one word with its spaces in it. Every other word
  // ends at a space, the quotes of free text included.
  const words =
    input.match(new RegExp(`[a-z]+:${QUOTED_VALUE_PATTERN}|\\S+`, "gi")) ?? [];
  const rest: string[] = [];
  for (const word of words) {
    const match = word.match(/^([a-z]+):([\s\S]+)$/i);
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

/**
 * A filter as a person types it, the inverse of `parseFilterValue`:
 * `industry:"Venture Capital"`, `contacted:>90d`, `near:Paris/50km`. A value
 * with a space goes in double quotes, so the query reads it as one word.
 */
export function formatFacet(filter: FacetFilter): string {
  const value = /\s/.test(filter.value) ? `"${filter.value}"` : filter.value;
  return filter.field === "near"
    ? `near:${value}/${filter.km ?? 25}km`
    : `${filter.field}:${filter.operator ?? ""}${value}`;
}

/** Filters as one query, which `parseFacetQuery` reads back to them. */
export function formatFacetQuery(filters: readonly FacetFilter[]): string {
  return filters.map(formatFacet).join(" ");
}
