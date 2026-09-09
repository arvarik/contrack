import { contactRepo } from "../../repositories/contactRepository.ts";
import { sqlite } from "../../db.ts";
import type { HydratedContact } from "../../repositories/types.ts";
import { contentHash } from "../../utils/aiCache.ts";
import { ACTIVE_CONTACT_SQL } from "../search/ftsIndex.ts";
import { AppError } from "../../utils/AppError.ts";

/**
 * Read an active local contact before accepting an enrichment result.
 *
 * Unscoped by design: both callers check the owner first, the enrich route
 * with `requireOwned` and the AI Search batch with the contacts it was given.
 */
export function enrichmentContact(id: string): HydratedContact {
  const row = sqlite
    .prepare(
      // tenant-lint: allow owner-checked by caller
      `SELECT c.* FROM contacts c WHERE c.id = ? AND ${ACTIVE_CONTACT_SQL}`,
    )
    .get(id);
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
