/**
 * Participant matching for connectors. Per run, two queries build in-memory
 * maps from mailbox (see canonicalEmailAddress) and normalized phone to
 * contact id. It applies the self-address exclusion, gives the interaction to
 * the primary contact (the first match that is not the owner), and records
 * other matches as mentions.
 *
 * @module server/connectors/matching
 */

import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { normalizePhone } from "../utils/nlp/phone.ts";
import { canonicalEmailAddress } from "./email/normalize.ts";
import type { Participant } from "../../shared/connectors.ts";

export interface MatchResult {
  /** The first non-self contact matched, who owns the interaction. */
  primaryContactId: string | null;
  /** Additional distinct contacts matched (excluding primary), for mentions. */
  mentionContactIds: string[];
  /** Participants that did not match any known contact and are not self. */
  unknownParticipants: Participant[];
  /** Whether at least one participant matched the user's self addresses. */
  hasSelf: boolean;
}

export interface ContactMatcher {
  resolveContactId(participant: Participant): string | null;
  matchParticipants(
    participants: Participant[],
    selfAddresses: { emails: string[]; phones: string[] },
  ): MatchResult;
  registerContact(
    contactId: string,
    emails?: string[],
    phones?: string[],
  ): void;
}

/**
 * Creates a ContactMatcher seeded from database rows owned by `scope`.
 */
export function buildContactMatcher(scope: Scope): ContactMatcher {
  const matcher = createMatcherFromMaps(new Map(), new Map());

  const emailRows = sqlite
    .prepare(
      `SELECT ce.contactId, ce.email
       FROM contact_emails ce
       JOIN contacts c ON c.id = ce.contactId
       WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND ce.email IS NOT NULL`,
    )
    .all(scope.ownerId) as Array<{ contactId: string; email: string }>;
  for (const row of emailRows) {
    matcher.registerContact(row.contactId, [row.email]);
  }

  const phoneRows = sqlite
    .prepare(
      `SELECT cp.contactId, cp.phone
       FROM contact_phones cp
       JOIN contacts c ON c.id = cp.contactId
       WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND cp.phone IS NOT NULL`,
    )
    .all(scope.ownerId) as Array<{ contactId: string; phone: string }>;
  for (const row of phoneRows) {
    matcher.registerContact(row.contactId, [], [row.phone]);
  }

  return matcher;
}

/**
 * Creates a ContactMatcher from existing maps (useful for unit tests with
 * mocked data). The email map is keyed by mailbox (`canonicalEmailAddress`),
 * so "ana.lee+news@gmail.com" finds the contact with "analee@gmail.com".
 */
export function createMatcherFromMaps(
  emailMap: Map<string, string>,
  phoneMap: Map<string, string>,
): ContactMatcher {
  function resolveContactId(participant: Participant): string | null {
    if (participant.email) {
      const id = emailMap.get(canonicalEmailAddress(participant.email));
      if (id) return id;
    }
    if (participant.phone) {
      const norm = normalizePhone(participant.phone);
      const id = phoneMap.get(norm);
      if (id) return id;
    }
    return null;
  }

  function isSelf(
    p: Participant,
    selfEmails: Set<string>,
    selfPhones: Set<string>,
  ): boolean {
    if (p.email && selfEmails.has(canonicalEmailAddress(p.email))) {
      return true;
    }
    if (p.phone && selfPhones.has(normalizePhone(p.phone))) {
      return true;
    }
    return false;
  }

  return {
    resolveContactId,

    matchParticipants(
      participants: Participant[],
      selfAddresses: { emails: string[]; phones: string[] },
    ): MatchResult {
      // By mailbox, so the owner's "+tag" and dotted Gmail spellings are
      // the owner too, and not strangers to suggest.
      const selfEmails = new Set(
        selfAddresses.emails.map((e) => canonicalEmailAddress(e)),
      );
      const selfPhones = new Set(
        selfAddresses.phones.map((p) => normalizePhone(p)),
      );

      let primaryContactId: string | null = null;
      const mentionIdsSet = new Set<string>();
      const unknownParticipants: Participant[] = [];
      let hasSelf = false;

      for (const p of participants) {
        if (isSelf(p, selfEmails, selfPhones)) {
          hasSelf = true;
          continue;
        }

        const matchedId = resolveContactId(p);
        if (matchedId) {
          if (!primaryContactId) {
            primaryContactId = matchedId;
          } else if (matchedId !== primaryContactId) {
            mentionIdsSet.add(matchedId);
          }
        } else {
          unknownParticipants.push(p);
        }
      }

      return {
        primaryContactId,
        mentionContactIds: Array.from(mentionIdsSet),
        unknownParticipants,
        hasSelf,
      };
    },

    registerContact(
      contactId: string,
      emails: string[] = [],
      phones: string[] = [],
    ): void {
      for (const email of emails) {
        const mailbox = canonicalEmailAddress(email);
        if (mailbox && !emailMap.has(mailbox)) {
          emailMap.set(mailbox, contactId);
        }
      }
      for (const phone of phones) {
        const norm = normalizePhone(phone);
        if (norm && !phoneMap.has(norm)) {
          phoneMap.set(norm, contactId);
        }
      }
    },
  };
}
