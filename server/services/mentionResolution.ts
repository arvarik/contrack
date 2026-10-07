// Mention resolution: which contact is "Jon"?
//
// A note says "lunch with Jon and Priya". A model pulls the names out, and this
// decides who they are. An exact match on `contacts.name` misses most of what a
// person writes ("Jon" for "Jonathan Smith", "Maria Garcia" for "María García",
// "Dr. Chen" for "Sarah Chen"), and every miss would make a ghost that joins
// the mention graph. So this points the dedupe engine's name machinery (a
// tokenizer that strips titles, a nickname table, Double Metaphone and
// Jaro-Winkler) at one name.
//
// Three outcomes:
//
//   link    confident enough to attach the mention to an existing contact
//   review  plausible, so make the ghost AND a suggestion pairing it with
//           the candidate, reviewed in the same queue as a duplicate
//   ghost   nothing close, so a new person
//
// The middle one is the point: without it every near miss would become a second
// record of a person the account already has, and nobody would be told.

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

// Thresholds

/**
 * Attach the mention to this contact without asking. High, because the two
 * mistakes cost differently: a wrong link puts one person's lunch in another's
 * timeline with nothing on screen to show it, while a missed link makes a
 * ghost, which is visible and merges away in one click.
 */
export const MENTION_LINK_THRESHOLD = 0.9;

/**
 * Make the ghost, and a suggestion that it might be this contact. Below this
 * the candidate is not worth anybody's attention: a queue full of "could this
 * Ana be that Ana" goes unread, and the dedupe engine finds a real duplicate
 * later anyway.
 */
export const MENTION_REVIEW_THRESHOLD = 0.7;

/**
 * How far ahead the best candidate must be to be linked at all. Two contacts
 * that score the same are the father-and-son case ("James Whitfield" at one
 * firm, twice), where linking is a coin flip, so a close second demotes the
 * answer to review however high the top score is.
 */
const AMBIGUITY_MARGIN = 0.05;

// Shapes

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
   * Normalized company, or null when the mention named none. `normalizeCompany`
   * runs thirty-two suffix regexes and is the most expensive step here (217
   * ms per 50,000 calls, against 41 ms for Double Metaphone), and most mentions
   * carry no company to compare, so it is skipped for them.
   */
  companyNorm: string | null;
}

/**
 * What one note needs whichever name is being resolved: only the co-mention
 * set. Candidates are fetched per name, because loading and tokenizing a whole
 * address book of fifty thousand costs 326 ms of event loop per saved note.
 */
export interface MentionCorpus {
  scope: Scope;
  /** Contacts that have appeared in a note beside the contact this note is on. */
  coMentioned: Set<string>;
}

/**
 * Who already turns up beside this contact: two people in one note are more
 * likely the two in front of you than strangers with the same first name.
 * `interaction_mentions` has no owner of its own, so the join to `interactions`
 * supplies one: a name in my note can only be somebody in my address book.
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
 * The contacts worth tokenizing for this one name, in two queries.
 *
 * The first reads `phoneticHash`, indexed on (ownerId, phoneticHash), for
 * sound-alikes and most accents: Double Metaphone folds most of them, so "Søren
 * Kjærgaard" and "Soren Kjaergaard" share a code.
 *
 * The second ORs every name prefix into one statement. A `LIKE` on a name
 * cannot use an index, so one query per pattern scans the account each time:
 * five patterns take 34 ms on 50,000 contacts, one statement 6 ms. Prefixes are
 * three characters, so a misspelling in either half of the name still matches
 * ("Vanse" starts "van"), and every short form of the first name gets one too,
 * because "Bob" and "Robert" share none. No `LOWER()`: SQLite's LIKE already
 * folds ASCII case.
 */
function fetchCandidates(
  scope: Scope,
  tokens: string[],
  phonetic: string,
): MentionCandidateContact[] {
  // The status half only. `ownerId = ?` is written into each statement below,
  // so `tenant-lint` sees the owner check in the literal it scans.
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

// Matching

/**
 * Score one candidate against one mentioned name, or null when no tier fires,
 * which is most of the corpus for most names. The first tier that fires wins:
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
 * Decide what to do with one mentioned name. The margin matters as much as the
 * threshold: a name that scores 0.95 against two contacts is two answers, and
 * linking one is a coin flip nothing on screen would reveal.
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

  // Sort by confidence, then by contact id, so ties resolve the same way on
  // every run.
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
