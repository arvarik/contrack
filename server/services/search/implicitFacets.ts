// =============================================================================
// Implicit facets: filters read from the words of a question
// =============================================================================
// "people in Lisbon" and "who works at Northwind Logistics" are filters, and
// a model adds nothing to them. This module reads such phrases as facets,
// deterministically and conservatively:
//
//   "at X", "works at X"                 a company facet, when X is a company
//                                        in the owner's data
//   "in X", "based in X", "near X",      a location facet, when X is a place
//   "around X"                           in the owner's data
//   "in X"                               an industry facet, when X is an
//                                        industry in the owner's data
//
// X must equal a known value, not merely contain one. A place followed by a
// comma and another place ("Paris, Texas"), by "and" or "or" ("New York and
// London"), by a word such as "State", or by another known place is left to
// the planner, which knows which Paris is meant. A value that is both a
// place and an industry is left to it as well.
//
// The known values are read once per owner and search revision.
// =============================================================================

import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { FacetFilter } from "../../../shared/searchFacets.ts";
import { foldName } from "../../utils/nlp/givenNames.ts";

export interface ImplicitFacets {
  /** The facets the question's words hold, in the order they appear. */
  filters: FacetFilter[];
  /** The question without the phrases the facets took. */
  remainder: string;
}

interface KnownValues {
  revision: number;
  /** Normalized value to the value as the owner wrote it. */
  companies: Map<string, string>;
  places: Map<string, string>;
  industries: Map<string, string>;
}

type ValueKind = "company" | "place" | "industry";

/** Owners whose known values are kept. The least recently used one goes first. */
const MAX_OWNERS = 50;
const known = new Map<string, KnownValues>();

/** Words a place value spans at most. */
const MAX_VALUE_WORDS = 6;

/**
 * Words that ask for people or join a question, and carry no constraint.
 * A remainder made only of these needs no model.
 */
const FILLER = new Set([
  "who",
  "whos",
  // The s of "who's", which the word split leaves on its own.
  "s",
  "which",
  "what",
  "find",
  "show",
  "list",
  "give",
  "me",
  "all",
  "any",
  "every",
  "people",
  "person",
  "persons",
  "folks",
  "contacts",
  "contact",
  "anyone",
  "anybody",
  "someone",
  "somebody",
  "everyone",
  "everybody",
  "i",
  "my",
  "our",
  "we",
  "know",
  "knows",
  "the",
  "a",
  "an",
  "of",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "that",
  "there",
  "works",
  "work",
  "working",
  "lives",
  "live",
  "living",
  "based",
  "located",
  "in",
  "at",
  "near",
  "around",
]);

/** Words that make the place before them part of a longer place name. */
const QUALIFIERS = new Set([
  "state",
  "city",
  "county",
  "province",
  "region",
  "area",
  "district",
  "metro",
  "borough",
  "island",
  "islands",
  "bay",
  "valley",
  "coast",
]);

/** Words after a value that join it to another value. */
const JOINERS = new Set(["and", "or", "&", "/", "+"]);

/** Lower case, accents folded, punctuation as spaces. */
function normalize(text: string): string {
  return foldName(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function currentRevision(scope: Scope): number {
  const row = sqlite
    .prepare("SELECT revision FROM search_revision WHERE ownerId = ?")
    .get(scope.ownerId) as { revision: number } | undefined;
  return row?.revision ?? 0;
}

/** The owner's distinct companies, places and industries, cached per revision. */
function knownValues(scope: Scope): KnownValues {
  const revision = currentRevision(scope);
  const cached = known.get(scope.ownerId);
  if (cached?.revision === revision) {
    known.delete(scope.ownerId);
    known.set(scope.ownerId, cached);
    return cached;
  }
  const distinct = (column: "company" | "location" | "industry") =>
    (
      sqlite
        .prepare(
          `SELECT DISTINCT c.${column} AS value FROM contacts c
           WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
             AND c.${column} IS NOT NULL AND trim(c.${column}) != ''`,
        )
        .all(scope.ownerId) as { value: string }[]
    ).map((row) => row.value.trim());

  const index = (values: string[]) => {
    const map = new Map<string, string>();
    for (const value of values) {
      const key = normalize(value);
      if (key && !map.has(key)) map.set(key, value);
    }
    return map;
  };
  // A place is a whole location or one of its comma-separated parts:
  // "San Francisco, California" gives both of its parts as well.
  const places = distinct("location").flatMap((location) => [
    location,
    ...location
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  ]);
  const values: KnownValues = {
    revision,
    companies: index(distinct("company")),
    places: index(places),
    industries: index(distinct("industry")),
  };
  known.delete(scope.ownerId);
  known.set(scope.ownerId, values);
  if (known.size > MAX_OWNERS) known.delete(known.keys().next().value!);
  return values;
}

/** A preposition phrase and the kinds of value it can introduce. */
function prepositionAt(
  words: string[],
  i: number,
): { length: number; kinds: ValueKind[] } | null {
  const word = words[i]?.toLowerCase();
  const next = words[i + 1]?.toLowerCase();
  if ((word === "works" || word === "working") && next === "at")
    return { length: 2, kinds: ["company"] };
  if (word === "based" && next === "in") return { length: 2, kinds: ["place"] };
  if (word === "at") return { length: 1, kinds: ["company"] };
  if (word === "in") return { length: 1, kinds: ["place", "industry"] };
  if (word === "near" || word === "around")
    return { length: 1, kinds: ["place"] };
  return null;
}

/**
 * True when the words after a place value make it part of a longer place,
 * or join it to a second one.
 */
function qualified(words: string[], end: number, values: KnownValues): boolean {
  const next = words[end];
  if (next === undefined) return false;
  const lower = next.toLowerCase();
  if (next === ",") {
    // "In Lisbon, who climbs?" is a clause. "Paris, Texas" is a place.
    const after = words[end + 1]?.toLowerCase();
    return after === undefined || !FILLER.has(after);
  }
  return (
    JOINERS.has(lower) ||
    QUALIFIERS.has(lower) ||
    values.places.has(normalize(next))
  );
}

/**
 * Read company, place and industry facets out of a question.
 *
 * Returns the facets and the question without the phrases they took. The
 * facets only ever name values the owner's own contacts hold.
 */
export function findImplicitFacets(
  scope: Scope,
  query: string,
): ImplicitFacets {
  const words = query.match(/[\p{L}\p{N}][\p{L}\p{N}'’.&-]*|,/gu) ?? [];
  if (!words.length) return { filters: [], remainder: query.trim() };
  const values = knownValues(scope);
  const filters: FacetFilter[] = [];
  const used = new Array<boolean>(words.length).fill(false);

  for (let i = 0; i < words.length; i++) {
    const preposition = prepositionAt(words, i);
    if (!preposition) continue;
    const start = i + preposition.length;
    for (
      let end = Math.min(words.length, start + MAX_VALUE_WORDS);
      end > start;
      end--
    ) {
      if (words[end - 1] === ",") continue;
      const key = normalize(words.slice(start, end).join(" "));
      if (!key) continue;
      const matches = preposition.kinds.flatMap((kind) => {
        const map =
          kind === "company"
            ? values.companies
            : kind === "place"
              ? values.places
              : values.industries;
        const value = map.get(key);
        return value ? [{ kind, value }] : [];
      });
      if (!matches.length) continue;
      // A value that is both a place and an industry is the planner's call.
      if (matches.length > 1) break;
      const [{ kind, value }] = matches;
      if (kind === "place" && qualified(words, end, values)) break;
      filters.push({
        field:
          kind === "company"
            ? "company"
            : kind === "place"
              ? "location"
              : "industry",
        value,
      });
      for (let j = i; j < end; j++) used[j] = true;
      i = end - 1;
      break;
    }
  }

  const remainder = words
    .filter((word, index) => !used[index] && word !== ",")
    .join(" ");
  return { filters, remainder };
}

/**
 * True when a remainder still says something a filter does not: a word that
 * is not a question word, a filler word or a preposition.
 */
export function hasContentWords(remainder: string): boolean {
  return (remainder.match(/[\p{L}\p{N}]+/gu) ?? []).some(
    (word) => !FILLER.has(foldName(word)),
  );
}
