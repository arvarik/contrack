// =============================================================================
// Starter questions: the pool behind "Try asking" on Ask Contrack
// =============================================================================
// Each account has a hidden pool of questions built from its own contacts:
// the industries, cities, companies, roles, interests and tags that two
// people or more share, and the industry and city pairs. The Ask page
// shows six of them at random, so the list changes from visit to visit.
//
// Every question names a value some contact holds, in words the search
// answers without a model: "Who works at X?", "Who do I know in X?" and
// "Who works in X?" are facets (implicitFacets.ts), and the rest match the
// keyword index. A press on a question always finds somebody. Schools are
// left out: the keyword index does not hold education, so "Who studied at
// X?" found nobody who did without a model.
//
// The pool never holds more questions than the account has contacts.
//
// Building a pool is a few grouped reads. The pool is kept per owner and
// search revision, so an edit to a searched column builds it again. The
// server builds every owner's pool in the background after boot, and an
// import schedules its owner's pool as soon as the contacts commit. So the
// first open of Ask after a deploy or an import reads a pool that is ready.
// =============================================================================

import { sqlite } from "../../db.ts";
import { ACTIVE_CONTACT_SQL } from "./ftsIndex.ts";
import { foldName } from "../../utils/nlp/givenNames.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { scopeForOwnerId, type Scope } from "../../tenancy/scope.ts";
import type {
  StarterKind,
  StarterQuestion,
} from "../../../shared/starterQuestions.ts";

/** The most questions a pool holds. */
export const POOL_LIMIT = 40;
/**
 * From this many contacts, a value must be shared by two people to become a
 * question. Below it, one person is enough, or a small network has no pool.
 */
const SHARED_FROM = 10;
/** A tag on more than this share of the network says nothing about anyone. */
const TAG_SHARE = 0.6;
/** A value longer than this is a sentence, not a name. */
const MAX_CHARS = 40;
/** Implicit facets read a value of at most this many words. */
const MAX_WORDS = 6;
/** Owners whose pools are kept. The least recently used one goes first. */
const MAX_OWNERS = 200;
/**
 * A pool this many edits behind is still served at once, and built again
 * in the background. The revision moves once per contact written, so an
 * import or a bulk delete is far past it, and those build before they answer.
 */
const STALE_EDITS = 25;

/** The order kinds take turns in, so a cut pool keeps its variety. */
const KIND_ORDER: readonly StarterKind[] = [
  "industry",
  "city",
  "company",
  "interest",
  "role",
  "pair",
  "tag",
];

interface Pool {
  revision: number;
  questions: StarterQuestion[];
}

interface Tally {
  value: string;
  count: number;
}

const pools = new Map<string, Pool>();
/** Owners with a build already scheduled. */
const scheduled = new Set<string>();

const stmts = {
  revision: sqlite.prepare(
    "SELECT revision FROM search_revision WHERE ownerId = ?",
  ),
  active: sqlite.prepare(
    `SELECT COUNT(*) AS n FROM contacts c WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}`,
  ),
  column: (column: "industry" | "company" | "location" | "role") =>
    sqlite.prepare(
      `SELECT c.${column} AS value, COUNT(*) AS n FROM contacts c
        WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
          AND c.${column} IS NOT NULL AND trim(c.${column}) != ''
        GROUP BY c.${column}`,
    ),
  pairs: sqlite.prepare(
    `SELECT c.industry AS industry, c.location AS location, COUNT(*) AS n
       FROM contacts c
      WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
        AND c.industry IS NOT NULL AND trim(c.industry) != ''
        AND c.location IS NOT NULL AND trim(c.location) != ''
      GROUP BY c.industry, c.location`,
  ),
  // One row per contact and interest: the table's unique index holds it.
  interests: sqlite.prepare(
    `SELECT i.interest AS value, COUNT(*) AS n
       FROM contact_interests i JOIN contacts c ON c.id = i.contactId
      WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
      GROUP BY i.interest`,
  ),
  tags: sqlite.prepare(
    `SELECT t.tag AS value, COUNT(DISTINCT t.contactId) AS n
       FROM contact_tags t JOIN contacts c ON c.id = t.contactId
      WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}
      GROUP BY t.tag`,
  ),
  owners: sqlite.prepare(
    // Every owner with a contact, to build each one's own pool at boot.
    // tenant-lint: allow instance sweep
    `SELECT c.ownerId AS ownerId FROM contacts c
      WHERE c.ownerId IS NOT NULL AND ${ACTIVE_CONTACT_SQL}
      GROUP BY c.ownerId`,
  ),
};
const columnStmts = {
  industry: stmts.column("industry"),
  company: stmts.column("company"),
  location: stmts.column("location"),
  role: stmts.column("role"),
};

/** Lower case, accents folded, punctuation and runs of space as one space. */
const keyOf = (value: string): string =>
  foldName(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** One space between words, and no space at either end. */
const tidy = (value: string): string => value.replace(/\s+/g, " ").trim();

/** A value short and plain enough to read as a name in a question. */
function nameLike(value: string): boolean {
  if (value.length < 2 || value.length > MAX_CHARS) return false;
  if (!/\p{L}/u.test(value)) return false;
  if (/@|https?:|www\.|[|;{}<>\\?]/i.test(value)) return false;
  return value.split(" ").length <= MAX_WORDS;
}

/**
 * The values, each spelling folded into one, most shared first. The spelling
 * most contacts use names the group, so "fintech" and "Fintech" are one
 * value, written the way the owner mostly writes it.
 */
function tally(rows: readonly { value: string; n: number }[]): Tally[] {
  const groups = new Map<
    string,
    { count: number; spellings: Map<string, number> }
  >();
  for (const row of rows) {
    const value = tidy(row.value ?? "");
    if (!nameLike(value)) continue;
    const key = keyOf(value);
    if (!key) continue;
    const group = groups.get(key) ?? { count: 0, spellings: new Map() };
    group.count += row.n;
    group.spellings.set(value, (group.spellings.get(value) ?? 0) + row.n);
    groups.set(key, group);
  }
  const out: Tally[] = [];
  for (const group of groups.values()) {
    let best = "";
    let bestCount = 0;
    for (const [spelling, count] of group.spellings) {
      if (count > bestCount || (count === bestCount && spelling < best)) {
        best = spelling;
        bestCount = count;
      }
    }
    out.push({ value: best, count: group.count });
  }
  return out.sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  );
}

/** "a" or "an" before a role, by how its first word is said. */
export function article(role: string): "a" | "an" {
  const word = role.split(/\s+/)[0] ?? "";
  // An initialism is said letter by letter: an SVP, an MBA, a CTO.
  if (word.length >= 2 && word === word.toUpperCase() && /^\p{Lu}/u.test(word))
    return /^[AEFHILMNORSX]/.test(word) ? "an" : "a";
  const lower = word.toLowerCase();
  if (/^[aeio]/.test(lower)) return "an";
  // "a UX designer", "a university lecturer", "an undergraduate".
  if (/^u/.test(lower))
    return /^u(?:ni|s[eu]|ti|x|i$)/.test(lower) ? "a" : "an";
  return "a";
}

/** A role the question can name: a title, not a sentence about a job. */
function roleLike(role: string): boolean {
  return !/\s(?:at|@)\s|\d/i.test(role) && role.split(" ").length <= 5;
}

/** The first part of a location, which is what a person calls the place. */
const cityOf = (location: string): string => tidy(location.split(",")[0] ?? "");

/**
 * Build one owner's pool from its contacts, in the order the kinds take
 * turns, cut to {@link POOL_LIMIT} and to the number of contacts.
 */
export function buildStarterQuestions(scope: Scope): StarterQuestion[] {
  const owner = scope.ownerId;
  const people = (stmts.active.get(owner) as { n: number }).n;
  if (people === 0) return [];
  const least = people >= SHARED_FROM ? 2 : 1;
  const shared = (list: Tally[]) => list.filter((t) => t.count >= least);
  type Row = { value: string; n: number };

  const industryRows = columnStmts.industry.all(owner) as Row[];
  const locations = columnStmts.location.all(owner) as Row[];
  const industryKeys = new Set(industryRows.map((row) => keyOf(row.value)));
  const placeKeys = new Set(
    locations.flatMap((row) => [
      keyOf(row.value),
      ...row.value.split(",").map((part) => keyOf(part)),
    ]),
  );
  // "in X" reads X as a place or an industry. A value that is both is left
  // to the planner, so neither question could promise its people.
  const industries = shared(tally(industryRows)).filter(
    (t) => !placeKeys.has(keyOf(t.value)),
  );
  const companies = shared(tally(columnStmts.company.all(owner) as Row[]));
  const cities = shared(
    tally(locations.map((row) => ({ value: cityOf(row.value), n: row.n }))),
  ).filter((t) => !industryKeys.has(keyOf(t.value)));
  const roles = shared(
    tally(columnStmts.role.all(owner) as Row[]).filter((t) =>
      roleLike(t.value),
    ),
  );
  // A value that is a known place or industry would be read as a facet by
  // "interested in X", and so would find the wrong people.
  const interests = shared(
    tally(stmts.interests.all(owner) as Row[]).filter(
      (t) =>
        !placeKeys.has(keyOf(t.value)) && !industryKeys.has(keyOf(t.value)),
    ),
  );
  const tags = shared(
    tally(stmts.tags.all(owner) as Row[]).filter(
      (t) => people < SHARED_FROM || t.count <= people * TAG_SHARE,
    ),
  );
  // An industry and a city two people share, named with each half's own
  // spelling from the lists above. One person in a pair says no more than
  // a question about the city.
  const industryName = new Map(
    industries.map((t) => [keyOf(t.value), t.value]),
  );
  const cityName = new Map(cities.map((t) => [keyOf(t.value), t.value]));
  const pairCounts = new Map<string, Tally & { city: string }>();
  for (const row of stmts.pairs.all(owner) as {
    industry: string;
    location: string;
    n: number;
  }[]) {
    const industry = industryName.get(keyOf(row.industry));
    const city = cityName.get(keyOf(cityOf(row.location)));
    // "Fintech in Fintech" is not a pair.
    if (!industry || !city || keyOf(industry) === keyOf(city)) continue;
    const key = `${keyOf(industry)}\u0000${keyOf(city)}`;
    const pair = pairCounts.get(key) ?? { value: industry, city, count: 0 };
    pair.count += row.n;
    pairCounts.set(key, pair);
  }
  const pairs = [...pairCounts.values()]
    .filter((pair) => pair.count >= 2)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.value.localeCompare(b.value) ||
        a.city.localeCompare(b.city),
    );

  const byKind: Record<StarterKind, string[]> = {
    industry: industries.map((t) => `Who works in ${t.value}?`),
    city: cities.map((t) => `Who do I know in ${t.value}?`),
    company: companies.map((t) => `Who works at ${t.value}?`),
    interest: interests.map((t) => `Who is interested in ${t.value}?`),
    role: roles.map((t) => `Who works as ${article(t.value)} ${t.value}?`),
    pair: pairs.map((t) => `Who works in ${t.value} in ${t.city}?`),
    tag: tags.map((t) => `Who is tagged ${t.value}?`),
  };

  // Take turns: the best of each kind, then the second best, and so on, so
  // a network with many kinds gets a mix and one with few still fills.
  const questions: StarterQuestion[] = [];
  const seen = new Set<string>();
  const limit = Math.min(POOL_LIMIT, people);
  const longest = Math.max(...KIND_ORDER.map((kind) => byKind[kind].length));
  for (let round = 0; round < longest && questions.length < limit; round++) {
    for (const kind of KIND_ORDER) {
      const text = byKind[kind][round];
      if (!text || seen.has(text) || questions.length >= limit) continue;
      seen.add(text);
      questions.push({ text, kind });
    }
  }
  return questions;
}

function revisionOf(ownerId: string): number {
  const row = stmts.revision.get(ownerId) as { revision: number } | undefined;
  return row?.revision ?? 0;
}

/** Build and keep one owner's pool at the revision read before the build. */
function rebuild(scope: Scope): Pool {
  const revision = revisionOf(scope.ownerId);
  const pool = { revision, questions: buildStarterQuestions(scope) };
  pools.delete(scope.ownerId);
  pools.set(scope.ownerId, pool);
  if (pools.size > MAX_OWNERS) pools.delete(pools.keys().next().value!);
  return pool;
}

/**
 * The owner's pool, from memory.
 *
 * A pool built at the current revision is the answer. One a few edits
 * behind is the answer too, and a build is scheduled: those edits can
 * change a count, and rarely a question. A pool far behind, or none, is
 * built before the answer (about 20 ms at 5,000 contacts), so an import or a
 * bulk delete is never answered with the questions from before it.
 */
export function starterQuestions(scope: Scope): StarterQuestion[] {
  const pool = pools.get(scope.ownerId);
  const revision = revisionOf(scope.ownerId);
  if (
    pool &&
    revision - pool.revision <= STALE_EDITS &&
    revision >= pool.revision
  ) {
    pools.delete(scope.ownerId);
    pools.set(scope.ownerId, pool);
    if (pool.revision !== revision) scheduleStarterQuestions(scope.ownerId);
    return pool.questions;
  }
  return rebuild(scope).questions;
}

/**
 * Build the owner's pool soon, off the request that changed its contacts.
 * An import calls this once its contacts commit. Two calls before the build
 * runs build once.
 */
export function scheduleStarterQuestions(ownerId: string): void {
  if (scheduled.has(ownerId)) return;
  scheduled.add(ownerId);
  setImmediate(() => {
    scheduled.delete(ownerId);
    try {
      rebuild(scopeForOwnerId(ownerId));
    } catch (error) {
      log.warn(
        "StarterQuestions",
        `Pool build failed: ${getErrorMessage(error)}`,
      );
    }
  });
}

/**
 * Build every owner's pool, one owner per turn of the event loop, so the
 * requests that arrive after a deploy never wait behind the whole set.
 */
export async function warmStarterQuestions(): Promise<number> {
  const started = performance.now();
  const owners = (stmts.owners.all() as { ownerId: string }[]).map(
    (row) => row.ownerId,
  );
  let built = 0;
  for (const ownerId of owners) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      rebuild(scopeForOwnerId(ownerId));
      built += 1;
    } catch (error) {
      log.warn(
        "StarterQuestions",
        `Pool build failed: ${getErrorMessage(error)}`,
      );
    }
  }
  log.info(
    "StarterQuestions",
    `Built ${built} question pools in ${Math.round(performance.now() - started)}ms`,
  );
  return built;
}

/** For tests: forget every pool. */
export function resetStarterQuestions(): void {
  pools.clear();
  scheduled.clear();
}
