/**
 * server/connectors/matching.ts — Participant matching engine for connectors.
 *
 * Builds per-run in-memory maps from normalized email and phone to contact ID
 * in two queries. Applies the self-address exclusion rule, selects the primary
 * contact (first non-self match) to own the interaction, and routes additional
 * matches to interaction mentions.
 *
 * @module server/connectors/matching
 */

import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { normalizePhone } from "../utils/nlp/phone.ts";
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
  const emailMap = new Map<string, string>();
  const phoneMap = new Map<string, string>();

  // Load all emails for this owner
  const emailRows = sqlite
    .prepare(
      `SELECT ce.contactId, LOWER(ce.email) AS email
       FROM contact_emails ce
       JOIN contacts c ON c.id = ce.contactId
       WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND ce.email IS NOT NULL`,
    )
    .all(scope.ownerId) as Array<{ contactId: string; email: string }>;

  for (const row of emailRows) {
    const trimmed = row.email.trim();
    if (trimmed && !emailMap.has(trimmed)) {
      emailMap.set(trimmed, row.contactId);
    }
  }

  // Load all phones for this owner
  const phoneRows = sqlite
    .prepare(
      `SELECT cp.contactId, cp.phone
       FROM contact_phones cp
       JOIN contacts c ON c.id = cp.contactId
       WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND cp.phone IS NOT NULL`,
    )
    .all(scope.ownerId) as Array<{ contactId: string; phone: string }>;

  for (const row of phoneRows) {
    const normalized = normalizePhone(row.phone);
    if (normalized && !phoneMap.has(normalized)) {
      phoneMap.set(normalized, row.contactId);
    }
  }

  return createMatcherFromMaps(emailMap, phoneMap);
}

/**
 * Creates a ContactMatcher from existing maps (useful for unit tests with mocked data).
 */
export function createMatcherFromMaps(
  emailMap: Map<string, string>,
  phoneMap: Map<string, string>,
): ContactMatcher {
  function resolveContactId(participant: Participant): string | null {
    if (participant.email) {
      const lower = participant.email.trim().toLowerCase();
      const id = emailMap.get(lower);
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
    if (p.email && selfEmails.has(p.email.trim().toLowerCase())) {
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
      const selfEmails = new Set(
        selfAddresses.emails.map((e) => e.trim().toLowerCase()),
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
        const lower = email.trim().toLowerCase();
        if (lower && !emailMap.has(lower)) {
          emailMap.set(lower, contactId);
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
