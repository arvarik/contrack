import { contactRepo } from "../../repositories/contactRepository.ts";
import { sqlite } from "../../db.ts";
import type { HydratedContact } from "../../repositories/types.ts";
import { contentHash } from "../../utils/aiCache.ts";
import { ACTIVE_CONTACT_SQL } from "../search/ftsIndex.ts";
import { AppError } from "../../utils/AppError.ts";
import type { Scope } from "../../tenancy/scope.ts";

/**
 * Read one of this account's active contacts before enriching it.
 *
 * The owner is in the same statement as the id, so a contact another account
 * owns is not found here. It keeps the 409 a deleted or archived id has
 * always taken rather than becoming a 404: the two answers are identical
 * either way, which is what the rule about not distinguishing "gone" from
 * "not yours" is for, and the endpoint's existing contract is unchanged.
 */
export function enrichmentContact(scope: Scope, id: string): HydratedContact {
  const row = sqlite
    .prepare(
      `SELECT c.* FROM contacts c
        WHERE c.id = ? AND c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}`,
    )
    .get(id, scope.ownerId);
  const contact = row ? contactRepo.hydrate(row) : null;
  if (!contact)
    throw new AppError("Contact is no longer available for enrichment.", 409);
  return contact;
}

/** Retain user fields and child records when comparing local contact versions. */
export function contactFingerprint(contact: object): string {
  const derived = new Set([
    "updatedAt",
    "relationshipScore",
    "relationshipHealth",
    "aiBriefing",
    "aiBriefingAt",
    "aiHydratedAt",
  ]);
  return contentHash(
    JSON.stringify(contact, (key, value) =>
      derived.has(key) ? undefined : value,
    ),
  );
}

const active = new Set<string>();

/** Reject overlapping actions for the same contact before either can write a stale result. */
export function lockEnrichment(id: string): () => void {
  if (active.has(id))
    throw new AppError(
      "Research for this contact is already in progress.",
      409,
    );
  active.add(id);
  return () => {
    active.delete(id);
  };
}
