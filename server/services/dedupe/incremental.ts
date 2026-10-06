// Incremental matching: one corpus, any number of new contacts.
//
// Checking a new contact for duplicates compares it with every contact the
// account owns, and most of that work does not depend on the contact:
// normalizing the corpus, loading phone numbers, the pairs marked as different
// people, the social links. Done per contact, an import of `n` contacts into a
// corpus of `m` costs about `n × m`. So `buildIncrementalCorpus` does the
// account's part once, and `findIncrementalPairs` the contact's part per
// contact.
//
// The confidences come from policy.ts, the table the scan reads, so an import
// and a scan agree on what a shared number or an exact name is worth
// (`tests/integration/dedupe.import.test.ts` holds the numbers).

import { log } from "../../utils/logger.ts";
import {
  isNicknameMatch,
  isMiddleNameExtension,
  isSharedMailbox,
} from "../../utils/nlp/index.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import {
  findNearestNeighbors,
  getEmbedding,
  isEmbeddingAvailable,
} from "./embeddings.ts";
import { loadNegativeConstraints, pairKey } from "./blocking.ts";
import {
  loadProfileUrls,
  normalizeContactById,
  normalizeContacts,
} from "./normalization.ts";
import {
  countValues,
  generationsContradict,
  NAME_CONFIDENCE,
  weighAnchor,
  weighName,
  weighNameOnly,
} from "./policy.ts";
import {
  computeCompositeScore,
  computeMatchSignals,
  distanceToSimilarity,
  unverifiedConfidence,
} from "./scoring.ts";
import {
  buildScoringReasoning,
  crossSourceReason,
  nicknameReason,
  REASON,
  scoringCaveat,
} from "./reasons.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { NormalizedContact, RawPair, ValueFrequency } from "./types.ts";

/** How many vector neighbors one new contact is compared with. */
const KNN_LIMIT = 5;

/**
 * Everything an incremental check needs that belongs to the account rather
 * than to the contact being checked.
 */
export interface IncrementalCorpus {
  scope: Scope;
  rid: string;
  /** Pairs the account has already said are two different people. */
  distinctPairs: Set<string>;
  /** Every active contact, normalized. */
  normalized: NormalizedContact[];
  normalizedById: Map<string, NormalizedContact>;
  /** Normalized phone number to the contacts that carry it. */
  contactsByPhone: Map<string, string[]>;
  /** Lowercased email to the contacts that carry it. */
  contactsByEmail: Map<string, string[]>;
  /** Normalized personal profile links, by contact (`loadProfileUrls`). */
  socialUrlsByContact: Map<string, string[]>;
  /** A normalized profile link to the active contacts that carry it. */
  contactsBySocial: Map<string, string[]>;
  /** How widely each address, number and name is shared in the account. */
  frequency: ValueFrequency;
  /** True while the vector store can answer, checked once. */
  embeddingsAvailable: boolean;
  /**
   * Contacts that stopped being candidates during the run. A batch merges as it
   * goes, so a contact merged away by an earlier pair must not be offered to a
   * later one, which the snapshot above cannot know.
   */
  retired: Set<string>;
}

/**
 * Load and normalize one account, once: five queries and one normalization
 * pass. `normalizeContacts` is the expensive half, about a second at ten
 * thousand contacts, which per contact would repeat for every row of an import.
 */
export function buildIncrementalCorpus(
  scope: Scope,
  rid: string,
): IncrementalCorpus {
  const t0 = Date.now();

  const normalized = normalizeContacts(scope);
  const normalizedById = new Map(normalized.map((n) => [n.id, n]));

  // Both maps come from the normalized rows, not their own queries, so a
  // contact that is a candidate by phone is one the name matcher sees too.
  // Otherwise a pair's other half could have no normalized record for the
  // scorer.
  const contactsByPhone = new Map<string, string[]>();
  const contactsByEmail = new Map<string, string[]>();
  for (const contact of normalized) {
    for (const phone of contact.phonesNorm) {
      if (!contactsByPhone.has(phone)) contactsByPhone.set(phone, []);
      contactsByPhone.get(phone)!.push(contact.id);
    }
    for (const email of contact.emailsNorm) {
      if (!contactsByEmail.has(email)) contactsByEmail.set(email, []);
      contactsByEmail.get(email)!.push(contact.id);
    }
  }

  // Every contact's links, the new ones included, and an index of the links
  // the active contacts carry, which is what a new contact is matched with.
  const socialUrlsByContact = loadProfileUrls(scope);
  const contactsBySocial = new Map<string, string[]>();
  for (const contact of normalized) {
    for (const url of socialUrlsByContact.get(contact.id) ?? []) {
      if (!contactsBySocial.has(url)) contactsBySocial.set(url, []);
      contactsBySocial.get(url)!.push(contact.id);
    }
  }

  const corpus: IncrementalCorpus = {
    scope,
    rid,
    distinctPairs: loadNegativeConstraints(scope),
    normalized,
    normalizedById,
    contactsByPhone,
    contactsByEmail,
    socialUrlsByContact,
    contactsBySocial,
    frequency: countValues(normalized),
    embeddingsAvailable: isEmbeddingAvailable(),
    retired: new Set(),
  };

  log.debug(
    "DedupeService",
    `[${rid}] Incremental corpus built in ${Date.now() - t0}ms: ${normalized.length} contacts, ${corpus.distinctPairs.size} negative constraints`,
  );
  return corpus;
}

/**
 * The contact to compare against the corpus, read through
 * `normalizeContactById` even when the corpus has it: the two builders can
 * order `sources` differently, and that string appears in a cross-source
 * match's reasoning. It does not filter out ghosts or archived contacts,
 * because the caller asked about this one. The corpus side is active contacts
 * only.
 */
export function normalizeTarget(
  corpus: IncrementalCorpus,
  contactId: string,
): NormalizedContact | null {
  return normalizeContactById(corpus.scope, contactId);
}

/** Whether this contact can still be one half of a pair. */
function isCandidate(
  corpus: IncrementalCorpus,
  contactId: string,
  targetId: string,
  seen: Set<string>,
): boolean {
  if (contactId === targetId) return false;
  if (corpus.retired.has(contactId)) return false;
  const pk = pairKey(targetId, contactId);
  return !seen.has(pk) && !corpus.distinctPairs.has(pk);
}

/**
 * Every duplicate of one contact, inside its own account. Four matchers in
 * order of certainty: a shared email, a shared phone, a name that matches
 * exactly or through a nickname, and a vector neighbor that scores high enough
 * on the full signal set. The first claim on a pair wins, so an email match is
 * never scored again as a fuzzy one. `seen` is shared across a batch, so a pair
 * between two new contacts is produced once, not twice.
 */
export function findIncrementalPairs(
  corpus: IncrementalCorpus,
  contactId: string,
  target: NormalizedContact,
  seen: Set<string>,
): RawPair[] {
  const pairs: RawPair[] = [];

  const claim = (otherId: string, pair: Omit<RawPair, "idA" | "idB">): void => {
    seen.add(pairKey(contactId, otherId));
    pairs.push({ idA: contactId, idB: otherId, ...pair });
  };

  // 1. A shared email address that names a person. A shared mailbox is skipped,
  //    as in the scan's exact-email rule: two contacts on `team.northwind@` are
  //    colleagues and two on `haddad.family@` a household, and an import must
  //    not merge one away. The fuzzy matcher still sees the pair. The match is
  //    weighed, not claimed outright, like the scan's D1.
  for (const email of target.emailsNorm) {
    if (isSharedMailbox(email)) continue;
    for (const otherId of corpus.contactsByEmail.get(email) ?? []) {
      if (!isCandidate(corpus, otherId, contactId, seen)) continue;
      const other = corpus.normalizedById.get(otherId);
      if (!other) continue;
      const weighed = weighAnchor(
        "email",
        target,
        other,
        corpus.frequency.emails.get(email) ?? 2,
      );
      claim(otherId, {
        matchType: "email",
        confidence: weighed.confidence,
        reasoning: REASON.email,
        matchedField: email,
        caveat: weighed.caveat,
      });
    }
  }

  // 2. A shared phone number, weighed like the scan's D2. A household on one
  //    landline is the case: "Ada Twin" and "Ben Twin" on one number reach a
  //    person instead of becoming one.
  for (const phone of target.phonesNorm) {
    for (const otherId of corpus.contactsByPhone.get(phone) ?? []) {
      if (!isCandidate(corpus, otherId, contactId, seen)) continue;
      const other = corpus.normalizedById.get(otherId);
      if (!other) continue;
      const weighed = weighAnchor(
        "phone",
        target,
        other,
        corpus.frequency.phones.get(phone) ?? 2,
      );
      claim(otherId, {
        matchType: "phone",
        confidence: weighed.confidence,
        reasoning: REASON.phone,
        matchedField: phone,
        caveat: weighed.caveat,
      });
    }
  }

  // 2b. The same personal profile link, like the scan's D2b: one LinkedIn page
  // on a new contact and an old one is one person, whatever the name, and a
  // link three contacts carry asks.
  for (const url of corpus.socialUrlsByContact.get(contactId) ?? []) {
    const carriers = corpus.contactsBySocial.get(url) ?? [];
    for (const otherId of carriers) {
      if (!isCandidate(corpus, otherId, contactId, seen)) continue;
      const other = corpus.normalizedById.get(otherId);
      if (!other) continue;
      const weighed = weighAnchor(
        "social",
        target,
        other,
        Math.max(2, new Set([...carriers, contactId]).size),
      );
      claim(otherId, {
        matchType: "social",
        confidence: weighed.confidence,
        reasoning: REASON.social,
        matchedField: url,
        caveat: weighed.caveat,
      });
    }
  }

  // 3. The same name, or a nickname of it. Blocked on the shared keys, so
  //    this is a scan of the corpus and not a comparison with all of it.
  if (target.nameNorm) {
    const targetBlockKeys = new Set(target.blockKeys);
    for (const other of corpus.normalized) {
      if (!isCandidate(corpus, other.id, contactId, seen)) continue;
      if (!other.blockKeys.some((key) => targetBlockKeys.has(key))) continue;

      if (
        target.nameNorm === other.nameNorm &&
        !generationsContradict(target, other)
      ) {
        // The scan's D3, rule for rule: the same name at the same company
        // outranks the same name from two sources, which outranks the same name
        // alone. "Hale Sr." beside "Hale Jr." normalize alike and are two
        // people, so they never match exactly. A suffix on one side only
        // ("Arthur Pemberton" beside "Arthur Pemberton III") is neither, and
        // keeps the plain name confidence, which asks.
        const sameGeneration = target.generation === other.generation;
        const sameCompany =
          sameGeneration &&
          target.companyNorm.length > 1 &&
          other.companyNorm.length > 1 &&
          target.companyNorm === other.companyNorm;
        const isCrossSource =
          sameGeneration &&
          target.sources.length > 0 &&
          other.sources.length > 0 &&
          !target.sources.some((s) => other.sources.includes(s));
        // Without the company the name is the whole claim, so a different
        // employer or city on the two records caps it for review, as in the
        // scan's D3.
        const carriers = corpus.frequency.names.get(target.nameNorm) ?? 2;
        const weighed = sameCompany
          ? weighName(NAME_CONFIDENCE.nameCompany, carriers)
          : isCrossSource
            ? weighNameOnly(
                NAME_CONFIDENCE.crossSource,
                carriers,
                target,
                other,
              )
            : weighNameOnly(NAME_CONFIDENCE.name, carriers, target, other);
        claim(other.id, {
          matchType: sameCompany
            ? "name_company"
            : isCrossSource
              ? "cross_source"
              : "name",
          confidence: weighed.confidence,
          reasoning: sameCompany
            ? REASON.nameCompany
            : isCrossSource
              ? crossSourceReason(
                  [...target.sources].sort(),
                  [...other.sources].sort(),
                )
              : REASON.name,
          caveat: weighed.caveat,
        });
        continue;
      }

      if (
        target.lastNameNorm &&
        target.lastNameNorm === other.lastNameNorm &&
        target.firstNameNorm &&
        other.firstNameNorm &&
        isNicknameMatch(target.firstNameNorm, other.firstNameNorm)
      ) {
        const weighed = weighNameOnly(
          NAME_CONFIDENCE.nickname,
          2,
          target,
          other,
        );
        claim(other.id, {
          matchType: "nickname",
          confidence: weighed.confidence,
          reasoning: nicknameReason(target.firstNameNorm, other.firstNameNorm),
          caveat: weighed.caveat,
        });
        continue;
      }

      // The scan's D6. An import is where a middle name arrives ("Anton
      // Kovacs", then "Anton Peter Kovacs"), and without this the second lands
      // as a new person.
      if (isMiddleNameExtension(target.nameTokens, other.nameTokens)) {
        const weighed = weighNameOnly(
          NAME_CONFIDENCE.middleName,
          2,
          target,
          other,
        );
        claim(other.id, {
          matchType: "middle_name",
          confidence: weighed.confidence,
          reasoning: REASON.middleName,
          caveat: weighed.caveat,
        });
      }
    }
  }

  // 4. Vector neighbors, scored on the full signal set.
  if (corpus.embeddingsAvailable) {
    try {
      const queryVector = getEmbedding(contactId);
      const neighbors = queryVector
        ? findNearestNeighbors(corpus.scope, queryVector, KNN_LIMIT, contactId)
        : [];

      for (const neighbor of neighbors) {
        if (!isCandidate(corpus, neighbor.contactId, contactId, seen)) continue;
        // A vector can outlive its contact's place in the corpus: archiving
        // does not remove the row, so the KNN can still return it, and this
        // fallback keeps the pair reachable. Whether an archived contact should
        // be suggested at all is an open question.
        const other =
          corpus.normalizedById.get(neighbor.contactId) ??
          normalizeContactById(corpus.scope, neighbor.contactId);
        if (!other) continue;

        const signals = computeMatchSignals(
          target,
          other,
          distanceToSimilarity(neighbor.distance),
          // Never distinct: `isCandidate` already dropped pairs the account
          // marked as different people.
          false,
          corpus.socialUrlsByContact.get(target.id) ?? [],
          corpus.socialUrlsByContact.get(other.id) ?? [],
          corpus.frequency,
        );
        // No model checks a pair here, so the floor and weight of a scan
        // without a provider apply: an unclear pair is kept from 0.75, at 0.7
        // of its score.
        const confidence = unverifiedConfidence(computeCompositeScore(signals));
        if (confidence === null) continue;

        claim(neighbor.contactId, {
          matchType: "fuzzy",
          confidence,
          reasoning: buildScoringReasoning(signals),
          caveat: scoringCaveat(signals),
        });
      }
    } catch (err: unknown) {
      log.debug(
        "DedupeService",
        `[${corpus.rid}] Incremental KNN failed for ${contactId}: ${getErrorMessage(err)}`,
      );
    }
  }

  return pairs;
}
