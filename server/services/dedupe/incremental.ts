// =============================================================================
// Incremental matching — one corpus, any number of new contacts
// =============================================================================
// Checking a newly written contact for duplicates means comparing it with
// every other contact the same account owns. Most of that work does not
// depend on which contact is being checked: normalizing the corpus, loading
// the phone numbers, loading the pairs already marked as different people,
// loading the social links. Doing it per contact is what made an import of
// `n` contacts into a corpus of `m` cost about `n × m`.
//
// So it is split in two. `buildIncrementalCorpus` does the part that depends
// on the account, once. `findIncrementalPairs` does the part that depends on
// the contact, per contact. One contact created by hand builds the corpus and
// uses it once; an import of four hundred builds it once and uses it four
// hundred times.
//
// The matchers below are the ones that were inside the per-contact check, at
// the confidences they had. This is a rearrangement of the work, not a change
// to what counts as a duplicate, and `tests/integration/dedupe.import.test.ts`
// is what holds that true.
// =============================================================================

import { sqlite } from "../../db.ts";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
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
import { normalizeContactById, normalizeContacts } from "./normalization.ts";
import {
  classifyPair,
  computeCompositeScore,
  computeMatchSignals,
  distanceToSimilarity,
} from "./scoring.ts";
import { buildScoringReasoning } from "./passes.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { ContactRow, NormalizedContact, RawPair } from "./types.ts";

/** How many vector neighbours one new contact is compared with. */
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
  socialUrlsByContact: Map<string, string[]>;
  /** True while the vector store can answer, checked once. */
  embeddingsAvailable: boolean;
  /**
   * Contacts that stopped being candidates part way through the run.
   *
   * A batch merges as it goes, so a contact merged away by an earlier pair
   * must not be offered to a later one. The snapshot above cannot know that,
   * because it was taken before any of it happened.
   */
  retired: Set<string>;
}

/**
 * Load and normalize one account, once.
 *
 * Five queries and one normalization pass. `normalizeContacts` is the
 * expensive half and is the reason this function exists: it was called once
 * per contact checked, and on a corpus of ten thousand that is a second of
 * work repeated for every row of the import.
 */
export function buildIncrementalCorpus(
  scope: Scope,
  rid: string,
): IncrementalCorpus {
  const t0 = Date.now();

  const normalized = normalizeContacts(scope);
  const normalizedById = new Map(normalized.map((n) => [n.id, n]));

  // Both maps are built from the normalized rows rather than from their own
  // queries, so a contact that is a candidate by phone is a contact the name
  // matcher can also see. Two sets that disagreed would produce pairs whose
  // other half has no normalized record, which the scorer cannot use.
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

  const socialUrlsByContact = new Map<string, string[]>();
  const socialRows = sqlite
    .prepare(
      `SELECT sl.contactId, LOWER(TRIM(sl.url)) AS url FROM contact_social_links sl
       JOIN contacts c ON c.id = sl.contactId WHERE c.ownerId = ?`,
    )
    .all(scope.ownerId) as { contactId: string; url: string }[];
  for (const row of socialRows) {
    if (!socialUrlsByContact.has(row.contactId)) {
      socialUrlsByContact.set(row.contactId, []);
    }
    socialUrlsByContact.get(row.contactId)!.push(row.url);
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
 * The contact to compare against the corpus.
 *
 * Read through `normalizeContactById` even when the corpus already holds a
 * record for it. The two builders agree on every field the matchers read, but
 * they can order `sources` differently, and that string appears in the
 * reasoning a cross-source match writes. Five small indexed queries per new
 * contact is not the cost this story is about.
 *
 * `normalizeContactById` does not filter out ghosts or archived contacts: the
 * caller asked about this specific contact. The corpus on the other side is
 * active contacts only.
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
 * Every duplicate of one contact, inside its own account.
 *
 * Four matchers in order of certainty: a shared email address, a shared phone
 * number, a name that matches exactly or through a nickname, and a vector
 * neighbour that scores high enough on the full signal set. Each one takes
 * the first claim on a pair, so a contact that shares an email is reported as
 * an email match and never scored a second time as a fuzzy one.
 *
 * `seen` is passed in rather than created here. Across a batch it is shared,
 * so a pair between two newly imported contacts is produced once by whichever
 * of them is reached first, instead of twice in opposite orders.
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

  // 1. A shared email address that names a person.
  //
  // A shared mailbox is skipped here for the same reason the scan's
  // exact-email rule skips it: two contacts on `team.northwind@` are
  // colleagues and two on `haddad.family@` are a household, and claiming the
  // pair at 0.99 merges one of them away during an import. The fuzzy matcher
  // below still sees the pair.
  for (const email of target.emailsNorm) {
    if (isSharedMailbox(email)) continue;
    for (const otherId of corpus.contactsByEmail.get(email) ?? []) {
      if (!isCandidate(corpus, otherId, contactId, seen)) continue;
      claim(otherId, {
        matchType: "email",
        confidence: 0.99,
        reasoning: "Shared email address",
      });
    }
  }

  // 2. A shared phone number.
  for (const phone of target.phonesNorm) {
    for (const otherId of corpus.contactsByPhone.get(phone) ?? []) {
      if (!isCandidate(corpus, otherId, contactId, seen)) continue;
      claim(otherId, {
        matchType: "phone",
        confidence: 0.99,
        reasoning: "Shared phone number",
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

      if (target.nameNorm === other.nameNorm) {
        const isCrossSource =
          target.sources.length > 0 &&
          other.sources.length > 0 &&
          !target.sources.some((s) => other.sources.includes(s));
        claim(other.id, {
          matchType: isCrossSource ? "cross_source" : "name",
          confidence: isCrossSource ? 0.95 : 0.92,
          reasoning: isCrossSource
            ? `Exact name match across different sources (${target.sources[0]} ↔ ${other.sources[0]})`
            : "Exact name match",
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
        claim(other.id, {
          matchType: "nickname",
          confidence: 0.88,
          reasoning: `Nickname match ("${target.firstNameNorm}" ↔ "${other.firstNameNorm}")`,
        });
        continue;
      }

      // The same rule the scan runs as D6. An import is where a middle name
      // arrives: one export writes "Anton Kovacs" and the next writes "Anton
      // Peter Kovacs", and without this the second one lands as a new person.
      if (isMiddleNameExtension(target.nameTokens, other.nameTokens)) {
        claim(other.id, {
          matchType: "middle_name",
          confidence: 0.88,
          reasoning: `Same name with a middle name added ("${target.nameNorm}" ↔ "${other.nameNorm}")`,
        });
      }
    }
  }

  // 4. Vector neighbours, scored on the full signal set.
  if (corpus.embeddingsAvailable) {
    try {
      const queryVector = getEmbedding(contactId);
      const neighbors = queryVector
        ? findNearestNeighbors(corpus.scope, queryVector, KNN_LIMIT, contactId)
        : [];

      for (const neighbor of neighbors) {
        if (!isCandidate(corpus, neighbor.contactId, contactId, seen)) continue;
        // A vector can outlive its contact's place in the corpus: nothing
        // removes the row when a contact is archived, so the KNN still
        // answers with it while every other matcher here has stopped. The
        // fallback keeps that pair reachable, which is what the per-contact
        // check did. It is arguably wrong to suggest merging with a contact
        // somebody archived, and it is not this change's to fix.
        const other =
          corpus.normalizedById.get(neighbor.contactId) ??
          normalizeContactById(corpus.scope, neighbor.contactId);
        if (!other) continue;

        const signals = computeMatchSignals(
          target,
          other,
          distanceToSimilarity(neighbor.distance),
          // Never distinct. A pair the account marked as two different people
          // was dropped by `isCandidate` above, so the flag could only ever
          // be false by the time the scorer saw it.
          false,
          corpus.socialUrlsByContact.get(target.id) ?? [],
          corpus.socialUrlsByContact.get(other.id) ?? [],
        );
        const score = computeCompositeScore(signals);
        if (classifyPair(score) === "discard") continue;

        const rawA =
          (contactRepo.findOwned(
            corpus.scope,
            contactId,
          ) as ContactRow | null) ?? undefined;
        const rawB =
          (contactRepo.findOwned(
            corpus.scope,
            neighbor.contactId,
          ) as ContactRow | null) ?? undefined;
        claim(neighbor.contactId, {
          matchType: "fuzzy",
          confidence: score,
          reasoning: buildScoringReasoning(signals, score, rawA, rawB),
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
