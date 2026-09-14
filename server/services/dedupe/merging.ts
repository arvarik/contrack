import { scheduleSearchIndex } from "../search/indexQueue.ts";
import { sqlite, db } from "../../db.ts";
import * as schema from "../../../src/db/schema.ts";
import { and, eq } from "drizzle-orm";
import { log } from "../../utils/logger.ts";
import { contactRepo } from "../../repositories/contactRepository.ts";
import type { Scope } from "../../tenancy/scope.ts";
import { normalizePhone } from "../../utils/nlp/index.ts";
import { recordMergeUnsafe } from "./suggestions.ts";
import { NotFoundError } from "../../utils/AppError.ts";
import type { ContactRow, MergeSnapshotData } from "./types.ts";

/**
 * Load both sides of a merge in one statement that names the owner.
 *
 * This is the gate the whole file rests on. Sixty statements below re-parent
 * child rows by contact id alone, and they are safe to do that only because
 * both contacts came out of this one read: one statement, both ids, the owner
 * beside them. A row that belongs to somebody else is simply not in the
 * result, so the caller sees exactly what it sees for a row that never
 * existed, which is rule 4.
 *
 * It also makes the child re-parenting legal at the database level. Moving an
 * interaction between two contacts keeps its `ownerId`, and the Phase 1
 * mismatch trigger accepts that only when both contacts share the owner. That
 * is precisely what this statement proves, so it has to run before any child
 * statement, not alongside them.
 */
function loadMergePair(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
): { primary: ContactRow | undefined; duplicate: ContactRow | undefined } {
  const rows = sqlite
    .prepare("SELECT * FROM contacts WHERE id IN (?, ?) AND ownerId = ?")
    .all(primaryId, duplicateId, scope.ownerId) as ContactRow[];
  return {
    primary: rows.find((r) => r.id === primaryId),
    duplicate: rows.find((r) => r.id === duplicateId),
  };
}

/**
 * Move the duplicate's follow-up tasks onto the primary and settle both
 * caches.
 *
 * Tasks are the one child row a merge lost. Every other child table was
 * re-parented below, and `action_items` was not, so the hard merge's final
 * DELETE took every task the duplicate carried through ON DELETE CASCADE. A
 * soft merge left the rows in place, on a contact the list no longer shows,
 * which is the same loss with a longer fuse.
 *
 * Every row moves, completed ones included, and none is deleted. A task is a
 * commitment somebody made, and two that look alike are still two: the
 * merge is not the place to decide which of them to keep.
 *
 * `contacts.nextFollowUpAt` is MIN(dueAt) over the pending tasks, held by
 * trigger. The UPDATE trigger recomputes both sides of a move, so the two
 * statements after the transfer are the merge saying so itself rather than
 * leaning on a trigger it cannot see: the survivor must show the earliest
 * pending task of the pair, and the duplicate, whether it is about to be
 * deleted or to become a tombstone, must show none.
 *
 * Runs inside the caller's transaction. The owner predicate is on the
 * statement even though `loadMergePair` already proved both contacts belong
 * to this account, because a row written by an older version could carry an
 * owner that disagrees, and a row like that must not move.
 */
function transferActionItems(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
): number {
  const moved = sqlite
    .prepare(
      "UPDATE action_items SET contactId = ? WHERE contactId = ? AND ownerId = ?",
    )
    .run(primaryId, duplicateId, scope.ownerId).changes;

  const recompute = sqlite.prepare(
    `UPDATE contacts SET nextFollowUpAt = (
       SELECT MIN(dueAt) FROM action_items
        WHERE contactId = ? AND ownerId = ? AND completedAt IS NULL
     ) WHERE id = ? AND ownerId = ?`,
  );
  recompute.run(primaryId, scope.ownerId, primaryId, scope.ownerId);
  recompute.run(duplicateId, scope.ownerId, duplicateId, scope.ownerId);

  return moved;
}

export interface ExecuteMergeOptions {
  mergedBy: "user" | "auto";
  confidence: number;
  reasoning: string;
  rid: string;
}

export function executeMerge(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
  options: ExecuteMergeOptions,
) {
  const { mergedBy, confidence, reasoning, rid } = options;

  const { primary, duplicate } = loadMergePair(scope, primaryId, duplicateId);

  if (!primary) {
    throw new NotFoundError("Primary contact", primaryId);
  }

  if (!duplicate) {
    log.warn(
      "DedupeService",
      `[${rid}] Duplicate ${duplicateId} not found — skipping merge into ${primaryId}`,
    );
    return contactRepo.hydrate(primary);
  }

  if (duplicate.canonicalId) {
    log.warn(
      "DedupeService",
      `[${rid}] Duplicate ${duplicateId} already soft-merged — skipping`,
    );
    return contactRepo.hydrate(primary);
  }

  const mergeTxn = sqlite.transaction(() => {
    // Re-read inside the transaction so we observe a consistent snapshot.
    const primaryInTx = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ? AND ownerId = ?")
      .get(primaryId, scope.ownerId) as ContactRow | undefined;
    if (!primaryInTx) {
      throw new NotFoundError("Primary contact", primaryId);
    }
    const duplicateInTx = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ? AND ownerId = ?")
      .get(duplicateId, scope.ownerId) as ContactRow | undefined;
    if (!duplicateInTx) {
      log.warn(
        "DedupeService",
        `[${rid}] Duplicate ${duplicateId} vanished mid-merge — aborting txn`,
      );
      return;
    }
    if (duplicateInTx.canonicalId) {
      log.warn(
        "DedupeService",
        `[${rid}] Duplicate ${duplicateId} concurrently merged — aborting txn`,
      );
      return;
    }

    // 1. Take raw pre-merge snapshots of child records
    const dupeEmails = sqlite
      .prepare("SELECT * FROM contact_emails WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryEmails = sqlite
      .prepare("SELECT * FROM contact_emails WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupePhones = sqlite
      .prepare("SELECT * FROM contact_phones WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryPhones = sqlite
      .prepare("SELECT * FROM contact_phones WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeAddresses = sqlite
      .prepare("SELECT * FROM contact_addresses WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryAddresses = sqlite
      .prepare("SELECT * FROM contact_addresses WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeSocialLinks = sqlite
      .prepare("SELECT * FROM contact_social_links WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primarySocialLinks = sqlite
      .prepare("SELECT * FROM contact_social_links WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeEducation = sqlite
      .prepare("SELECT * FROM contact_education WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryEducation = sqlite
      .prepare("SELECT * FROM contact_education WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeExperience = sqlite
      .prepare("SELECT * FROM contact_experience WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryExperience = sqlite
      .prepare("SELECT * FROM contact_experience WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeSources = sqlite
      .prepare("SELECT * FROM contact_sources WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primarySources = sqlite
      .prepare("SELECT * FROM contact_sources WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeTags = sqlite
      .prepare("SELECT * FROM contact_tags WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryTags = sqlite
      .prepare("SELECT * FROM contact_tags WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeInterests = sqlite
      .prepare("SELECT * FROM contact_interests WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryInterests = sqlite
      .prepare("SELECT * FROM contact_interests WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeAttributes = sqlite
      .prepare("SELECT * FROM contact_attributes WHERE contactId = ?")
      .all(duplicateId) as Record<string, unknown>[];
    const primaryAttributes = sqlite
      .prepare("SELECT * FROM contact_attributes WHERE contactId = ?")
      .all(primaryId) as Record<string, unknown>[];

    const dupeInteractions = sqlite
      .prepare(
        // tenant-lint: allow owner-checked by caller
        "SELECT * FROM interactions WHERE contactId = ? AND ownerId = ?",
      )
      .all(duplicateId, scope.ownerId) as Record<string, unknown>[];

    const dupeActionItems = sqlite
      .prepare("SELECT * FROM action_items WHERE contactId = ? AND ownerId = ?")
      .all(duplicateId, scope.ownerId) as Record<string, unknown>[];

    const dupeMentions = sqlite
      .prepare(
        "SELECT interactionId, contactId FROM interaction_mentions WHERE contactId = ?",
      )
      .all(duplicateId) as { interactionId: string; contactId: string }[];

    const dupeListRows = sqlite
      .prepare("SELECT listId FROM list_members WHERE contactId = ?")
      .all(duplicateId) as { listId: string }[];
    const primaryListRows = sqlite
      .prepare("SELECT listId FROM list_members WHERE contactId = ?")
      .all(primaryId) as { listId: string }[];

    // 2. Child record mutations & change tracking

    // Interactions
    const movedInteractionIds = dupeInteractions.map((i) => i.id as string);
    if (movedInteractionIds.length > 0) {
      sqlite
        .prepare(
          // tenant-lint: allow owner-checked by caller
          "UPDATE interactions SET contactId = ? WHERE contactId = ? AND ownerId = ?",
        )
        .run(primaryId, duplicateId, scope.ownerId);
    }

    // Interaction mentions
    const primaryMentions = sqlite
      .prepare(
        "SELECT interactionId FROM interaction_mentions WHERE contactId = ?",
      )
      .all(primaryId) as { interactionId: string }[];
    const primaryMentionSet = new Set(
      primaryMentions.map((m) => m.interactionId),
    );
    const movedMentionInteractionIds: string[] = [];
    const deletedMentionInteractionIds: string[] = [];
    for (const dm of dupeMentions) {
      if (primaryMentionSet.has(dm.interactionId)) {
        deletedMentionInteractionIds.push(dm.interactionId);
      } else {
        movedMentionInteractionIds.push(dm.interactionId);
      }
    }
    if (movedMentionInteractionIds.length > 0) {
      sqlite
        .prepare(
          `UPDATE interaction_mentions SET contactId = ?
           WHERE contactId = ? AND interactionId NOT IN (
             SELECT interactionId FROM interaction_mentions WHERE contactId = ?
           )`,
        )
        .run(primaryId, duplicateId, primaryId);
    }
    if (deletedMentionInteractionIds.length > 0) {
      sqlite
        .prepare("DELETE FROM interaction_mentions WHERE contactId = ?")
        .run(duplicateId);
    }

    // Action items
    const movedActionItemIds = dupeActionItems.map((a) => a.id as string);
    const movedTasks = transferActionItems(scope, primaryId, duplicateId);
    if (movedTasks > 0) {
      log.info(
        "DedupeService",
        `[${rid}] Moved ${movedTasks} follow-up task(s) from ${duplicateId} to ${primaryId}`,
      );
    }

    // Emails
    const primaryEmailNorms = new Set(
      primaryEmails.map((e) =>
        ((e.email as string) || "").toLowerCase().trim(),
      ),
    );
    const movedEmailIds: string[] = [];
    for (const de of dupeEmails) {
      const norm = ((de.email as string) || "").toLowerCase().trim();
      if (!primaryEmailNorms.has(norm)) {
        movedEmailIds.push(de.id as string);
        primaryEmailNorms.add(norm);
      }
    }
    const hasPrimaryEmail = primaryEmails.length > 0;
    for (const id of movedEmailIds) {
      sqlite
        .prepare(
          "UPDATE contact_emails SET contactId = ?" +
            (hasPrimaryEmail ? ", isPrimary = 0" : "") +
            " WHERE id = ?",
        )
        .run(primaryId, id);
    }

    // Phones
    const primaryPhoneNorms = new Set(
      primaryPhones.map((p) => normalizePhone(p.phone as string)),
    );
    const movedPhoneIds: string[] = [];
    for (const dp of dupePhones) {
      const norm = normalizePhone(dp.phone as string);
      if (!primaryPhoneNorms.has(norm)) {
        movedPhoneIds.push(dp.id as string);
        primaryPhoneNorms.add(norm);
      }
    }
    const hasPrimaryPhone = primaryPhones.length > 0;
    for (const id of movedPhoneIds) {
      sqlite
        .prepare(
          "UPDATE contact_phones SET contactId = ?" +
            (hasPrimaryPhone ? ", isPrimary = 0" : "") +
            " WHERE id = ?",
        )
        .run(primaryId, id);
    }

    // Social Links
    const primarySocialKeys = new Set(
      primarySocialLinks.map(
        (s) =>
          `${((s.platform as string) || "").toLowerCase().trim()}::${((s.url as string) || "").toLowerCase().trim()}`,
      ),
    );
    const movedSocialLinkIds: string[] = [];
    for (const ds of dupeSocialLinks) {
      const key = `${((ds.platform as string) || "").toLowerCase().trim()}::${((ds.url as string) || "").toLowerCase().trim()}`;
      if (!primarySocialKeys.has(key)) {
        movedSocialLinkIds.push(ds.id as string);
        primarySocialKeys.add(key);
        sqlite
          .prepare("UPDATE contact_social_links SET contactId = ? WHERE id = ?")
          .run(primaryId, ds.id);
      }
    }

    // Education
    const primaryEduKeys = new Set(
      primaryEducation.map(
        (e) =>
          `${((e.school as string) || "").toLowerCase().trim()}::${((e.degree as string) || "").toLowerCase().trim()}`,
      ),
    );
    const movedEducationIds: string[] = [];
    for (const de of dupeEducation) {
      const key = `${((de.school as string) || "").toLowerCase().trim()}::${((de.degree as string) || "").toLowerCase().trim()}`;
      if (!primaryEduKeys.has(key)) {
        movedEducationIds.push(de.id as string);
        primaryEduKeys.add(key);
        sqlite
          .prepare("UPDATE contact_education SET contactId = ? WHERE id = ?")
          .run(primaryId, de.id);
      }
    }

    // Experience
    const primaryExpKeys = new Set(
      primaryExperience.map(
        (e) =>
          `${((e.company as string) || "").toLowerCase().trim()}::${((e.role as string) || "").toLowerCase().trim()}`,
      ),
    );
    const movedExperienceIds: string[] = [];
    for (const de of dupeExperience) {
      const key = `${((de.company as string) || "").toLowerCase().trim()}::${((de.role as string) || "").toLowerCase().trim()}`;
      if (!primaryExpKeys.has(key)) {
        movedExperienceIds.push(de.id as string);
        primaryExpKeys.add(key);
        sqlite
          .prepare("UPDATE contact_experience SET contactId = ? WHERE id = ?")
          .run(primaryId, de.id);
      }
    }

    // Sources
    const primarySrcKeys = new Set(
      primarySources.map(
        (s) =>
          `${((s.platform as string) || "").toLowerCase().trim()}::${((s.externalId as string) || "").toLowerCase().trim()}`,
      ),
    );
    const movedSourceIds: string[] = [];
    for (const ds of dupeSources) {
      const key = `${((ds.platform as string) || "").toLowerCase().trim()}::${((ds.externalId as string) || "").toLowerCase().trim()}`;
      if (!primarySrcKeys.has(key)) {
        movedSourceIds.push(ds.id as string);
        primarySrcKeys.add(key);
        sqlite
          .prepare("UPDATE contact_sources SET contactId = ? WHERE id = ?")
          .run(primaryId, ds.id);
      }
    }

    // Tags
    const primaryTagKeys = new Set(
      primaryTags.map((t) => ((t.tag as string) || "").toLowerCase().trim()),
    );
    const movedTagIds: string[] = [];
    for (const dt of dupeTags) {
      const norm = ((dt.tag as string) || "").toLowerCase().trim();
      if (!primaryTagKeys.has(norm)) {
        movedTagIds.push(dt.id as string);
        primaryTagKeys.add(norm);
        sqlite
          .prepare("UPDATE contact_tags SET contactId = ? WHERE id = ?")
          .run(primaryId, dt.id);
      }
    }

    // Interests
    const primaryInterestKeys = new Set(
      primaryInterests.map((i) =>
        ((i.interest as string) || "").toLowerCase().trim(),
      ),
    );
    const movedInterestIds: string[] = [];
    for (const di of dupeInterests) {
      const norm = ((di.interest as string) || "").toLowerCase().trim();
      if (!primaryInterestKeys.has(norm)) {
        movedInterestIds.push(di.id as string);
        primaryInterestKeys.add(norm);
        sqlite
          .prepare("UPDATE contact_interests SET contactId = ? WHERE id = ?")
          .run(primaryId, di.id);
      }
    }

    // Attributes
    const primaryAttrKeys = new Set(
      primaryAttributes.map((a) =>
        ((a.name as string) || "").toLowerCase().trim(),
      ),
    );
    const movedAttributeIds: string[] = [];
    for (const da of dupeAttributes) {
      const norm = ((da.name as string) || "").toLowerCase().trim();
      if (!primaryAttrKeys.has(norm)) {
        movedAttributeIds.push(da.id as string);
        primaryAttrKeys.add(norm);
        sqlite
          .prepare("UPDATE contact_attributes SET contactId = ? WHERE id = ?")
          .run(primaryId, da.id);
      }
    }

    // Addresses
    const primaryAddrKeys = new Set(
      primaryAddresses.map((a) =>
        ((a.address as string) || "").toLowerCase().trim(),
      ),
    );
    const movedAddressIds: string[] = [];
    for (const da of dupeAddresses) {
      const norm = ((da.address as string) || "").toLowerCase().trim();
      if (!primaryAddrKeys.has(norm)) {
        movedAddressIds.push(da.id as string);
        primaryAddrKeys.add(norm);
        sqlite
          .prepare("UPDATE contact_addresses SET contactId = ? WHERE id = ?")
          .run(primaryId, da.id);
      }
    }

    // List memberships
    const primaryListSet = new Set(primaryListRows.map((l) => l.listId));
    const addedListIds: string[] = [];
    const insertMember = sqlite.prepare(
      "INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)",
    );
    for (const dl of dupeListRows) {
      if (!primaryListSet.has(dl.listId)) {
        insertMember.run(dl.listId, primaryId);
        addedListIds.push(dl.listId);
      }
    }

    // Scalar fields
    const scalarFields = [
      "firstName",
      "lastName",
      "headline",
      "role",
      "company",
      "location",
      "birthday",
      "preferences",
      "avatarUrl",
      "about",
      "pronouns",
      "industry",
      "website",
      "lat",
      "lng",
      "aiHydratedAt",
      "aiBriefing",
      "aiBackground",
      "aiSummary",
      "aiBriefingAt",
    ] as const;
    const updates: Partial<
      Record<
        (typeof scalarFields)[number] | "updatedAt" | "addedAt",
        string | number | null
      >
    > = {
      updatedAt: new Date().toISOString(),
    };
    const scalarUpdates: Record<
      string,
      { oldValue: unknown; transferredValue: unknown }
    > = {};
    for (const field of scalarFields) {
      if (!primaryInTx[field] && duplicateInTx[field]) {
        updates[field] = duplicateInTx[field];
        scalarUpdates[field] = {
          oldValue: primaryInTx[field] ?? null,
          transferredValue: duplicateInTx[field],
        };
      }
    }
    let addedAtUpdated:
      { oldAddedAt: string | null; newAddedAt: string | null } | undefined;
    if (
      duplicateInTx.addedAt &&
      (!primaryInTx.addedAt || duplicateInTx.addedAt < primaryInTx.addedAt)
    ) {
      addedAtUpdated = {
        oldAddedAt: primaryInTx.addedAt,
        newAddedAt: duplicateInTx.addedAt,
      };
      updates.addedAt = duplicateInTx.addedAt;
    }

    db.update(schema.contacts)
      .set(updates as Partial<ContactRow>)
      .where(
        and(
          eq(schema.contacts.id, primaryId),
          eq(schema.contacts.ownerId, scope.ownerId),
        ),
      )
      .run();

    // 3. Tombstone the duplicate contact
    sqlite
      .prepare(
        "UPDATE contacts SET canonicalId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND ownerId = ?",
      )
      .run(primaryId, duplicateId, scope.ownerId);

    // 4. Assemble and record snapshot in dedupe_merge_log
    const snapshotData: MergeSnapshotData = {
      version: 1,
      primaryId,
      duplicateId,
      primary: {
        contact: primaryInTx as Record<string, unknown>,
        listIds: primaryListRows.map((l) => l.listId),
        emails: primaryEmails,
        phones: primaryPhones,
        addresses: primaryAddresses,
        attributes: primaryAttributes,
      },
      duplicate: {
        contact: duplicateInTx as Record<string, unknown>,
        listIds: dupeListRows.map((l) => l.listId),
        emails: dupeEmails,
        phones: dupePhones,
        addresses: dupeAddresses,
        socialLinks: dupeSocialLinks,
        education: dupeEducation,
        experience: dupeExperience,
        sources: dupeSources,
        tags: dupeTags,
        interests: dupeInterests,
        attributes: dupeAttributes,
        interactions: dupeInteractions,
        actionItems: dupeActionItems,
        mentions: dupeMentions,
      },
      changes: {
        movedRecords: {
          interactions: movedInteractionIds,
          actionItems: movedActionItemIds,
          emails: movedEmailIds,
          phones: movedPhoneIds,
          socialLinks: movedSocialLinkIds,
          education: movedEducationIds,
          experience: movedExperienceIds,
          sources: movedSourceIds,
          tags: movedTagIds,
          interests: movedInterestIds,
          attributes: movedAttributeIds,
          addresses: movedAddressIds,
        },
        movedMentions: movedMentionInteractionIds,
        deletedMentions: deletedMentionInteractionIds,
        scalarUpdates,
        addedListIds,
        addedAtUpdated,
      },
    };

    recordMergeUnsafe(
      scope,
      primaryId,
      duplicateId,
      confidence,
      reasoning,
      mergedBy,
      "soft",
      JSON.stringify(snapshotData),
    );
  });

  mergeTxn();
  scheduleSearchIndex(primaryId);
  log.info(
    "DedupeService",
    `[${rid}] Merged ${duplicateId} → ${primaryId} (by ${mergedBy}, confidence: ${(confidence * 100).toFixed(0)}%)`,
  );
  return contactRepo.hydrate(contactRepo.findOwned(scope, primaryId));
}

export function mergeContacts(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
  rid: string,
) {
  return executeMerge(scope, primaryId, duplicateId, {
    mergedBy: "user",
    confidence: 1.0,
    reasoning: "User-initiated merge",
    rid,
  });
}

export function softMergeContacts(
  scope: Scope,
  primaryId: string,
  duplicateId: string,
  confidence: number,
  reasoning: string,
  rid: string,
) {
  executeMerge(scope, primaryId, duplicateId, {
    mergedBy: "auto",
    confidence,
    reasoning,
    rid,
  });
}
