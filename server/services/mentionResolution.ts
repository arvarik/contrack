// =============================================================================
// Mention resolution — which contact is "Jon"?
// =============================================================================
// A timeline note says "lunch with Jon and Priya". A model pulls the two names
// out, and then something has to decide who they are. Until 2.0 that
// something was `eq(contacts.name, m.name)`: an exact string match against
// `contacts.name`, and a new ghost contact for every miss.
//
// An exact match misses almost everything a person writes. "Jon" does not
// find "Jonathan Smith". "Maria Garcia" does not find "María García". "Dr.
// Chen" does not find "Sarah Chen". Each miss made a ghost, the ghost joined
// the mention graph the dashboard and the warm paths read, and the next note
// about the same person made another one.
//
// The dedupe engine has already solved the hard half of this: a name
// tokenizer that strips titles, a nickname table, Double Metaphone, and
// Jaro-Winkler. This is that machinery pointed at one name instead of a pair.
//
// Three outcomes, not two:
//
//   link    confident enough to attach the mention to an existing contact
//   review  plausible, so make the ghost AND a suggestion pairing it with
//           the candidate, reviewed in the same queue as a duplicate
//   ghost   nothing close, so a new person, which is the old behaviour
//
// The middle one is the point. An exact match either found somebody or made a
// ghost, with nothing in between, so every near miss became a second record
// of a person the account already had and nobody was ever told.
// =============================================================================

import { sqlite } from "../db.ts";
import {
  areNicknameEquivalent,
  doubleMetaphone,
  jaroWinkler,
  NICKNAME_GROUPS,
  normalizeCompany,
  tokenizeName,
} from "../utils/nlp/index.ts";
import type { Scope } from "../tenancy/scope.ts";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Attach the mention to this contact without asking.
 *
 * High, because the cost of the two mistakes is not symmetric. A wrong link
 * puts one person's lunch in another person's timeline and there is nothing
 * on screen to suggest it is wrong. A missed link makes a ghost, which is
 * visible, reviewable and merges away in one click.
 */
export const MENTION_LINK_THRESHOLD = 0.9;

/**
 * Make the ghost, and a suggestion that it might be this contact.
 *
 * Below this the candidate is not worth somebody's attention: a queue full of
 * "could this Ana be that Ana" is a queue nobody reads, and the dedupe engine
 * will find a real duplicate later anyway.
 */
export const MENTION_REVIEW_THRESHOLD = 0.7;

/**
 * How far ahead the best candidate has to be to be linked at all.
 *
 * Two contacts that score the same are the father-and-son case: "James
 * Whitfield" at one firm, twice, one of them the son. Linking picks one at
 * random and is wrong half the time, so a close second demotes the answer to
 * review however high the top score is.
 */
const AMBIGUITY_MARGIN = 0.05;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One of the account's contacts, in the shape matching needs. */
export interface MentionCandidateContact {
  id: string;
  name: string;
  company: string | null;
  isGhost: number;
}

/** Why a contact was chosen, and how sure. */
export interface MentionMatch {
  contactId: string;
  name: string;
  confidence: number;
  tier: "exact" | "nickname" | "phonetic" | "fuzzy";
  reason: string;
}

export type MentionResolution =
  | { kind: "link"; match: MentionMatch }
  | { kind: "review"; match: MentionMatch }
  | { kind: "ghost"; runnerUp?: MentionMatch };

/** One candidate, tokenized. */
interface ScoredEntry {
  contact: MentionCandidateContact;
  nameNorm: string;
  firstName: string;
  lastName: string;
  phonetic: string;
  /**
   * Normalized company, or null when the mention named no company.
   *
   * `normalizeCompany` runs a loop of thirty-three suffix regexes and is by
   * some way the most expensive thing here: 217 ms per 50,000 calls, against
   * 41 ms for Double Metaphone and 25 ms for the tokenizer. Most mentions
   * carry no company, and for those there is nothing to compare against, so
   * computing it was more than half the cost of resolving a name for a
   * booster that could not fire.
   */
  companyNorm: string | null;
}

/**
 * What one note needs that does not depend on which name is being resolved.
 *
 * Only the co-mention set, because the candidates are fetched per name. The
 * first version loaded and tokenized the account's whole address book here,
 * which is fine at a thousand contacts and is not at fifty thousand: 326 ms
 * of event loop, once per saved note, to compare against a handful of names.
 */
export interface MentionCorpus {
  scope: Scope;
  /** Contacts that have appeared in a note beside the contact this note is on. */
  coMentioned: Set<string>;
}

/**
 * The account-level half of resolution: who already turns up beside this
 * contact.
 *
 * Two people who appear in a note together are more likely to be the two
 * people in front of you than two strangers with the same first name.
 *
 * `interaction_mentions` has no owner of its own, so the join to
 * `interactions` supplies one. A name in my note can only be somebody in my
 * address book, and a candidate from anywhere else is not a near miss.
 */
export function buildMentionCorpus(
  scope: Scope,
  anchorContactId: string,
): MentionCorpus {
  const coMentioned = new Set<string>(
    (
      sqlite
        .prepare(
          `SELECT DISTINCT im.contactId AS contactId
             FROM interaction_mentions im
             JOIN interactions i ON i.id = im.interactionId
            WHERE i.ownerId = ?
              AND (i.contactId = ?
                   OR im.interactionId IN (
                        SELECT interactionId FROM interaction_mentions
                         WHERE contactId = ?))`,
        )
        .all(scope.ownerId, anchorContactId, anchorContactId) as {
        contactId: string;
      }[]
    ).map((row) => row.contactId),
  );

  return { scope, coMentioned };
}

/** How much of a name token a LIKE has to agree on. Three survives a typo. */
const PREFIX_LENGTH = 3;

/** At most this many LIKE patterns, so one odd name cannot build a huge query. */
const MAX_PATTERNS = 10;

/**
 * The contacts worth tokenizing for this one name.
 *
 * Two queries, not one and not five.
 *
 * The first is `phoneticHash`, which has an index on (ownerId, phoneticHash)
 * and answers the sound-alike and most of the accent cases. Double Metaphone
 * already folds most accents, so "Søren Kjærgaard" and "Soren Kjaergaard"
 * carry the same code.
 *
 * The second is every name prefix, OR'd into one statement. A `LIKE` on a
 * name cannot use an index, so each pattern in its own query meant another
 * full scan of the account: five patterns cost 34 ms on 50,000 contacts, and
 * one statement costs 6 ms because the scan happens once.
 *
 * The prefixes are three characters, which keeps a misspelling in either half
 * of the name findable: "Vanse" still starts "van". Every short form of the
 * first name gets a prefix too, because "Bob" and "Robert" share none and a
 * LIKE cannot reach across the nickname table.
 *
 * No `LOWER()` around the column. SQLite's LIKE already folds ASCII case, so
 * it bought nothing and cost a function call per row scanned.
 */
function fetchCandidates(
  scope: Scope,
  tokens: string[],
  phonetic: string,
): MentionCandidateContact[] {
  // The status half only. `ownerId = ?` is written into each statement below
  // rather than interpolated, so `tenant-lint` reads the owner check in the
  // literal it scans instead of a fragment it cannot follow.
  const ACTIVE = `deletedAt IS NULL AND canonicalId IS NULL
      AND (isArchived = 0 OR isArchived IS NULL)`;
  const first = tokens[0] ?? "";
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : "";

  const patterns = new Set<string>();
  if (last.length >= PREFIX_LENGTH) {
    patterns.add(`%${last.slice(0, PREFIX_LENGTH)}%`);
  }
  if (first.length >= PREFIX_LENGTH) {
    patterns.add(`${first.slice(0, PREFIX_LENGTH)}%`);
  }
  for (const group of NICKNAME_GROUPS) {
    if (!group.includes(first)) continue;
    for (const form of group) {
      if (form.length >= PREFIX_LENGTH) {
        patterns.add(`${form.slice(0, PREFIX_LENGTH)}%`);
      }
    }
  }
  const likes = [...patterns].slice(0, MAX_PATTERNS);

  const byId = new Map<string, MentionCandidateContact>();
  const collect = (rows: MentionCandidateContact[]) => {
    for (const row of rows) if (row.name?.trim()) byId.set(row.id, row);
  };

  collect(
    sqlite
      .prepare(
        `SELECT id, name, company, isGhost FROM contacts
          WHERE ownerId = ? AND phoneticHash = ? AND ${ACTIVE}`,
      )
      .all(scope.ownerId, phonetic) as MentionCandidateContact[],
  );

  if (likes.length > 0) {
    collect(
      sqlite
        .prepare(
          `SELECT id, name, company, isGhost FROM contacts
            WHERE ownerId = ? AND ${ACTIVE}
              AND (${likes.map(() => "name LIKE ?").join(" OR ")})`,
        )
        .all(scope.ownerId, ...likes) as MentionCandidateContact[],
    );
  }

  return [...byId.values()];
}

/** Tokenize one candidate. Only the rows the query returned get here. */
function prepareEntry(
  contact: MentionCandidateContact,
  withCompany: boolean,
): ScoredEntry {
  const tokens = tokenizeName(contact.name);
  return {
    contact,
    nameNorm: tokens.join(" "),
    firstName: tokens[0] ?? "",
    lastName: tokens.length > 1 ? tokens[tokens.length - 1] : "",
    phonetic: doubleMetaphone(contact.name).primary,
    companyNorm: withCompany ? normalizeCompany(contact.company ?? "") : null,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Score one candidate against one mentioned name.
 *
 * Returns null when no tier fires at all, which is most of the corpus for
 * most names. The tiers are tried in order and the first that fires wins:
 * they are levels of evidence, not signals to add up.
 */
function scoreCandidate(
  entry: ScoredEntry,
  mentionTokens: string[],
  mentionPhonetic: string,
  mentionCompanyNorm: string,
  coMentioned: boolean,
): MentionMatch | null {
  const mentionNorm = mentionTokens.join(" ");
  if (mentionNorm.length === 0 || entry.nameNorm.length === 0) return null;

  const mentionFirst = mentionTokens[0] ?? "";
  const mentionLast =
    mentionTokens.length > 1 ? mentionTokens[mentionTokens.length - 1] : "";

  let base = 0;
  let tier: MentionMatch["tier"] = "fuzzy";
  let reason = "";

  if (entry.nameNorm === mentionNorm) {
    // "Dr. Sarah Chen" and "Sarah Chen" land here: the tokenizer strips the
    // title, so this tier is wider than the string equality it replaces.
    base = 0.97;
    tier = "exact";
    reason = `name matches "${entry.contact.name}"`;
  } else if (
    mentionLast &&
    entry.lastName === mentionLast &&
    areNicknameEquivalent(entry.firstName, mentionFirst)
  ) {
    base = 0.92;
    tier = "nickname";
    reason = `"${mentionFirst}" is a form of "${entry.firstName}", same surname`;
  } else if (
    !mentionLast &&
    entry.firstName &&
    (entry.firstName === mentionFirst ||
      areNicknameEquivalent(entry.firstName, mentionFirst))
  ) {
    // A bare first name. Deliberately below the review threshold on its own:
    // "Ana" is not evidence about which Ana, and only the boosters below can
    // carry it far enough to be worth showing somebody.
    base = 0.62;
    tier = entry.firstName === mentionFirst ? "exact" : "nickname";
    reason = `only a first name, "${mentionFirst}"`;
  } else if (mentionPhonetic && entry.phonetic === mentionPhonetic) {
    // "Maria Garcia" and "María García" reduce to the same code, and so do
    // "Smith" and "Smyth".
    base = 0.85;
    tier = "phonetic";
    reason = `sounds the same as "${entry.contact.name}"`;
  } else {
    const similarity = jaroWinkler(mentionNorm, entry.nameNorm);
    if (similarity < 0.9) return null;
    base = 0.6 + (similarity - 0.9) * 2.5;
    tier = "fuzzy";
    reason = `${Math.round(similarity * 100)}% similar to "${entry.contact.name}"`;
  }

  // Boosters. A company the note named, and a person this contact has shared
  // a note with before, are the two pieces of context a reader would use.
  if (
    mentionCompanyNorm.length > 1 &&
    entry.companyNorm !== null &&
    entry.companyNorm.length > 1 &&
    entry.companyNorm === mentionCompanyNorm
  ) {
    base += 0.12;
    reason += ", same company";
  }
  if (coMentioned) {
    base += 0.08;
    reason += ", has appeared in a note with this contact";
  }
  // A real contact outranks a ghost at the same evidence. A ghost is a record
  // of somebody nobody has confirmed, so resolving onto one should not beat
  // resolving onto a person the account actually knows.
  if (entry.contact.isGhost === 1) base -= 0.05;

  return {
    contactId: entry.contact.id,
    name: entry.contact.name,
    confidence: Math.max(0, Math.min(1, base)),
    tier,
    reason,
  };
}

/**
 * Decide what to do with one mentioned name.
 *
 * The margin check is as important as the threshold. A name that scores 0.95
 * against two contacts is not a confident answer, it is two answers, and
 * linking one of them is a coin flip nothing on screen would reveal.
 */
export function resolveMention(
  corpus: MentionCorpus,
  mention: { name: string; company?: string | null },
): MentionResolution {
  const tokens = tokenizeName(mention.name);
  if (tokens.length === 0) return { kind: "ghost" };

  const phonetic = doubleMetaphone(mention.name).primary;
  const companyNorm = normalizeCompany(mention.company ?? "");

  const scored: MentionMatch[] = [];
  const withCompany = companyNorm.length > 1;
  for (const contact of fetchCandidates(corpus.scope, tokens, phonetic)) {
    const match = scoreCandidate(
      prepareEntry(contact, withCompany),
      tokens,
      phonetic,
      companyNorm,
      corpus.coMentioned.has(contact.id),
    );
    if (match) scored.push(match);
  }
  if (scored.length === 0) return { kind: "ghost" };

  // Sort by confidence, then by contact id, so two candidates that score
  // identically resolve the same way on every run rather than in whatever
  // order the corpus query returned.
  scored.sort(
    (a, b) =>
      b.confidence - a.confidence || (a.contactId < b.contactId ? -1 : 1),
  );
  const best = scored[0];
  const second = scored[1];
  const ambiguous =
    second !== undefined &&
    best.confidence - second.confidence < AMBIGUITY_MARGIN;

  if (best.confidence >= MENTION_LINK_THRESHOLD && !ambiguous) {
    return { kind: "link", match: best };
  }
  if (best.confidence >= MENTION_REVIEW_THRESHOLD) {
    return {
      kind: "review",
      match: ambiguous
        ? {
            ...best,
            reason: `${best.reason}, and "${second!.name}" is as close`,
          }
        : best,
    };
  }
  return { kind: "ghost", runnerUp: best };
}
