// =============================================================================
// The merge policy — one answer to "how sure is sure enough"
// =============================================================================
// Three paths decide whether two contacts are one person with nobody asked: a
// scan somebody starts, the check every import runs, and the check that runs
// a few seconds after a contact is added by hand. Each of them used to carry
// its own numbers. The import path scored a shared phone number 0.99 where
// the scan scored it 0.95, scored an exact name across two sources 0.95 where
// the scan scored it 0.92, and ran at a fixed 0.93 whatever the account had
// chosen in Settings. So the same two records merged during an import and
// asked during a scan, and the sensitivity preset only reached one of the
// three.
//
// This module is the one place the numbers live. Every path reads its
// threshold from the account and its confidences from the tables below.
//
// Two rules weaken a match, and both are about what a shared value is
// evidence OF. A phone number on three contacts is a household line more
// often than one person recorded three times, and a name on three contacts
// is a common name. Splink calls the first idea term-frequency adjustment: a
// match on a value many records carry proves less than a match on a value
// two records carry. The second rule is a contradiction: a shared number
// between "Ada Twin" and "Ben Twin" is a family, not a duplicate, and the
// pair goes to a person rather than merging.
// =============================================================================

import {
  areNicknameEquivalent,
  doubleMetaphone,
  jaroWinkler,
} from "../../utils/nlp/index.ts";
import { getPreferences } from "../userPreferencesService.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { NormalizedContact, ValueFrequency } from "./types.ts";

// ---------------------------------------------------------------------------
// The threshold
// ---------------------------------------------------------------------------

export type MergePreset = "conservative" | "default" | "aggressive";

/**
 * The confidence a pair needs before it merges with nobody asked, per preset.
 *
 * The browser used to hold a copy of this table and send the number with
 * every scan request. Two copies drift, and the copy the import path read
 * was neither of them. The server reads the account's preset and this is the
 * only table.
 */
export const PRESET_THRESHOLDS: Record<MergePreset, number> = {
  aggressive: 0.88,
  default: 0.93,
  conservative: 0.97,
};

/**
 * The threshold with nothing chosen.
 *
 * A different number from `THRESHOLD_AUTO` in scoring.ts, which routes a pair
 * to the auto bucket rather than to the model. They have been equal since
 * they were written and they are still two decisions: one is "stop spending
 * tokens on this pair", the other is "change somebody's data without telling
 * them". Named and exported so the dedupe eval pins it.
 */
export const DEFAULT_AUTO_MERGE_THRESHOLD = PRESET_THRESHOLDS.default;

/** The threshold one preset names. */
export function thresholdForPreset(preset: MergePreset): number {
  return PRESET_THRESHOLDS[preset] ?? DEFAULT_AUTO_MERGE_THRESHOLD;
}

/**
 * The threshold this account has chosen.
 *
 * One read of `user_settings`. Every path that merges resolves its threshold
 * through here when the caller did not name one, so a preset set in Settings
 * reaches the scan, the import, and the single-contact check alike.
 */
export function autoMergeThresholdFor(scope: Scope): number {
  return thresholdForPreset(getPreferences(scope.ownerId).dedupePreset);
}

// ---------------------------------------------------------------------------
// The confidences
// ---------------------------------------------------------------------------

/** What a shared identifier is worth when nothing argues against it. */
export const ANCHOR_CONFIDENCE = {
  email: 0.98,
  phone: 0.95,
  social: 0.93,
} as const;

/** What a matching name is worth, by how it matched. */
export const NAME_CONFIDENCE = {
  /** The same name at the same company. */
  nameCompany: 0.95,
  /** The same name from two different import sources. */
  crossSource: 0.92,
  /** The same name and nothing else. Below every preset on purpose. */
  name: 0.9,
  nickname: 0.88,
  middleName: 0.88,
} as const;

/**
 * The most a contradicted match may score.
 *
 * Below the aggressive preset, so no preset merges a pair whose first names
 * disagree. Above `THRESHOLD_AI`, so the pair is still a suggestion rather
 * than nothing.
 */
export const REVIEW_CEILING = 0.85;

/** A value carried by more contacts than this is shared, not owned. */
export const SHARED_VALUE_LIMIT = 2;

/**
 * What each contact beyond the pair costs a match on a shared value.
 *
 * Small on purpose. A personal address on three records is usually one
 * person exported three times, and 0.98 less 0.03 still merges at the
 * default preset. A phone number on three records is a household as often
 * as not, and 0.95 less 0.03 asks. Four records of either ask.
 */
export const CARRIER_PENALTY = 0.03;

/** No weakening takes a whole claim below the band a person is asked about. */
export const WEAKEST_CLAIM = 0.6;

/** Four decimals, so a stored confidence reads as a number and not as noise. */
function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * A number, once the corpus and the names have spoken.
 *
 * Works on a weight as well as on a whole confidence, so it has no floor of
 * its own. `weighClaim` adds the floor for a whole pair.
 *
 * @param base         - What the match is worth on its own, from the tables.
 * @param carriers     - How many contacts in the account carry the value.
 * @param contradicted - Whether the two first names disagree.
 */
export function weaken(
  base: number,
  carriers: number,
  contradicted: boolean,
): number {
  let value =
    base - CARRIER_PENALTY * Math.max(0, carriers - SHARED_VALUE_LIMIT);
  if (contradicted) value = Math.min(value, REVIEW_CEILING);
  return round(Math.max(0, value));
}

/**
 * The confidence one shared identifier gives a pair.
 *
 * Floored at `WEAKEST_CLAIM`. A shared address is still a reason to ask,
 * however many contacts carry it, so the pair stays a suggestion.
 */
export function weighClaim(
  base: number,
  carriers: number,
  contradicted: boolean,
): number {
  return Math.max(WEAKEST_CLAIM, weaken(base, carriers, contradicted));
}

// ---------------------------------------------------------------------------
// How many contacts carry a value
// ---------------------------------------------------------------------------

/**
 * Count, per value, the active contacts that carry it.
 *
 * Built once from the normalized corpus, so a scan and an import count the
 * same rows the same way. Names are counted on the normalized name, which is
 * what the exact-name matchers compare.
 */
export function countValues(contacts: NormalizedContact[]): ValueFrequency {
  const emails = new Map<string, number>();
  const phones = new Map<string, number>();
  const names = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) => {
    if (key.length === 0) return;
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const contact of contacts) {
    for (const email of new Set(contact.emailsNorm)) bump(emails, email);
    for (const phone of new Set(contact.phonesNorm)) bump(phones, phone);
    bump(names, contact.nameNorm);
  }
  return { emails, phones, names };
}

/**
 * The widest sharing among the values two contacts have in common.
 *
 * Two when the map does not know a value, because the pair itself is two
 * carriers and the count can never be lower.
 */
export function carriersOf(
  counts: Map<string, number> | undefined,
  shared: string[],
): number {
  let most = SHARED_VALUE_LIMIT;
  for (const value of shared) {
    most = Math.max(most, counts?.get(value) ?? SHARED_VALUE_LIMIT);
  }
  return most;
}

// ---------------------------------------------------------------------------
// The contradiction
// ---------------------------------------------------------------------------

/**
 * Whether two first names say two different people.
 *
 * Deliberately narrow. Everything the duplicate matchers already accept as
 * one person is accepted here too: the same name, a nickname of it, an
 * initial of it, a spelling within Jaro-Winkler 0.9, or the same sound. What
 * remains is "ada" beside "ben", and a shared phone number between those two
 * is a household.
 *
 * Last names are not consulted. A married name changes the surname and not
 * the person, and that pair must keep merging on its shared address.
 */
export function firstNamesContradict(
  a: NormalizedContact,
  b: NormalizedContact,
): boolean {
  const fa = a.firstNameNorm;
  const fb = b.firstNameNorm;
  if (!fa || !fb || fa === fb) return false;

  // A one-token record is a whole name. "Ciccone" beside "Madonna Ciccone"
  // is not two people.
  if (a.nameTokens.length === 1 && fa === b.lastNameNorm) return false;
  if (b.nameTokens.length === 1 && fb === a.lastNameNorm) return false;

  // An initial agrees with any name that starts with it.
  if (fa.length === 1 || fb.length === 1) return fa[0] !== fb[0];

  if (areNicknameEquivalent(fa, fb)) return false;

  // A short form the nickname table does not know: "sue" and "susanna",
  // "abhi" and "abhishek". Three letters, so "al" cannot stand in for every
  // name that starts with it.
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (short.length >= 3 && long.startsWith(short)) return false;

  // A near spelling. 0.9 rather than 0.85: two four-letter names that share
  // three letters, "mark" and "mary", score 0.88 and are two people, while
  // a dropped or transposed letter in a real name scores above 0.93.
  if (jaroWinkler(fa, fb) >= 0.9) return false;

  const soundA = doubleMetaphone(fa).primary;
  const soundB = doubleMetaphone(fb).primary;
  if (soundA.length > 0 && soundA === soundB) return false;

  return true;
}

/**
 * Whether two names carry two different generational suffixes.
 *
 * "Robert Hale Sr." and "Robert Hale Jr." tokenize to one name, and they are
 * two people by definition. One side without a suffix says nothing: "Robert
 * Hale" beside "Robert Hale Jr." may well be one record with the suffix left
 * off.
 */
export function generationsContradict(
  a: NormalizedContact,
  b: NormalizedContact,
): boolean {
  return (
    a.generation !== null &&
    b.generation !== null &&
    a.generation !== b.generation
  );
}

/** Either contradiction. What the matchers read. */
export function namesContradict(
  a: NormalizedContact,
  b: NormalizedContact,
): boolean {
  return firstNamesContradict(a, b) || generationsContradict(a, b);
}

// ---------------------------------------------------------------------------
// One match, weighed
// ---------------------------------------------------------------------------

export interface WeighedMatch {
  confidence: number;
  /**
   * Why the confidence is lower than the table says, in words a reviewer
   * reads. Null when nothing weakened it.
   */
  caveat: string | null;
}

const VALUE_NOUN = {
  email: "address",
  phone: "number",
  social: "profile link",
  name: "name",
} as const;

/**
 * Weigh a shared identifier between two contacts.
 *
 * @param kind     - Which identifier the two share.
 * @param a        - One contact, normalized.
 * @param b        - The other.
 * @param carriers - How many contacts in the account carry the value.
 */
export function weighAnchor(
  kind: keyof typeof ANCHOR_CONFIDENCE,
  a: NormalizedContact,
  b: NormalizedContact,
  carriers: number,
): WeighedMatch {
  return weigh(ANCHOR_CONFIDENCE[kind], kind, carriers, a, b);
}

/**
 * Weigh an exact-name match.
 *
 * Only the count applies. The names agree by definition, so there is no
 * contradiction to look for.
 */
export function weighName(base: number, carriers: number): WeighedMatch {
  return weigh(base, "name", carriers, null, null);
}

function weigh(
  base: number,
  kind: keyof typeof VALUE_NOUN,
  carriers: number,
  a: NormalizedContact | null,
  b: NormalizedContact | null,
): WeighedMatch {
  const contradicted = a !== null && b !== null && namesContradict(a, b);
  const confidence = weighClaim(base, carriers, contradicted);
  const reasons: string[] = [];
  if (carriers > SHARED_VALUE_LIMIT) {
    reasons.push(`${carriers} contacts carry this ${VALUE_NOUN[kind]}`);
  }
  if (a && b && generationsContradict(a, b)) {
    // Sorted, so the same pair reads the same way whichever side was the
    // new contact.
    const [x, y] = [a.generation, b.generation].sort();
    reasons.push(`one is "${x}" and the other "${y}"`);
  } else if (contradicted && a && b) {
    reasons.push(
      `the first names differ ("${[a.firstNameNorm, b.firstNameNorm].sort().join('" ↔ "')}")`,
    );
  }
  return {
    confidence,
    caveat:
      reasons.length === 0
        ? null
        : `${reasons.join(", and ")}, so review this pair`,
  };
}

/** A base reasoning line with the caveat appended, when there is one. */
export function withCaveat(reasoning: string, match: WeighedMatch): string {
  return match.caveat ? `${reasoning}. ${match.caveat}` : reasoning;
}
