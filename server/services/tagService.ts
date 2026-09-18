// =============================================================================
// Tag Service — tag management across an account's contacts
// =============================================================================
// Tags belong to contacts, but a person thinks about tags as a vocabulary.
// This service gives the vocabulary its counts and its mutating actions:
//
//   getSummary   distinct tags with contact counts over unarchived contacts
//   renameTag    atomic rename and merge across the owner's contacts
//   deleteTag    remove a tag from all contacts owned by this account
//
// Every operation is scoped through contacts.ownerId in a single transaction.
// =============================================================================

import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import { aiCache } from "../utils/aiCache.ts";
import { scheduleSearchIndex } from "./search/indexQueue.ts";

export interface TagSummaryItem {
  tag: string;
  count: number;
}

const _stmts = {
  summary: sqlite.prepare(`
    SELECT ct.tag, COUNT(DISTINCT ct.contactId) AS count
      FROM contact_tags ct
      JOIN contacts c ON c.id = ct.contactId
     WHERE c.ownerId = ?
       AND (c.isArchived = 0 OR c.isArchived IS NULL)
       AND c.deletedAt IS NULL
     GROUP BY ct.tag
     ORDER BY ct.tag COLLATE NOCASE ASC
  `),

  contactsWithTag: sqlite.prepare(`
    SELECT DISTINCT ct.contactId
      FROM contact_tags ct
      JOIN contacts c ON c.id = ct.contactId
     WHERE c.ownerId = ?
       AND ct.tag = ?
  `),

  hasTag: sqlite.prepare(`
    SELECT 1 FROM contact_tags
     WHERE contactId = ? AND tag = ?
     LIMIT 1
  `),

  deleteTagForContact: sqlite.prepare(`
    DELETE FROM contact_tags
     WHERE contactId = ? AND tag = ?
  `),

  updateTagForContact: sqlite.prepare(`
    UPDATE contact_tags
       SET tag = ?
     WHERE contactId = ? AND tag = ?
  `),

  deleteTagForOwner: sqlite.prepare(`
    DELETE FROM contact_tags
     WHERE tag = ?
       AND contactId IN (SELECT id FROM contacts WHERE ownerId = ?)
  `),

  touchContact: sqlite.prepare(`
    UPDATE contacts
       SET updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND ownerId = ?
  `),
};

export const tagService = {
  getSummary(scope: Scope): TagSummaryItem[] {
    const rows = _stmts.summary.all(scope.ownerId) as Array<{
      tag: string;
      count: number;
    }>;
    return rows;
  },

  renameTag(
    scope: Scope,
    fromTag: string,
    toTag: string,
  ): { affected: number } {
    const from = fromTag.trim();
    const to = toTag.trim();
    if (!from || !to || from === to) {
      return { affected: 0 };
    }

    let affectedIds: string[] = [];
    sqlite.transaction(() => {
      const rows = _stmts.contactsWithTag.all(scope.ownerId, from) as Array<{
        contactId: string;
      }>;
      if (rows.length === 0) {
        return;
      }
      affectedIds = rows.map((r) => r.contactId);

      for (const contactId of affectedIds) {
        const alreadyHasTo = Boolean(_stmts.hasTag.get(contactId, to));
        if (alreadyHasTo) {
          // Merge: remove the fromTag instance so there are no duplicates
          _stmts.deleteTagForContact.run(contactId, from);
        } else {
          // Rename
          _stmts.updateTagForContact.run(to, contactId, from);
        }
        _stmts.touchContact.run(contactId, scope.ownerId);
      }
    })();

    if (affectedIds.length === 0) {
      return { affected: 0 };
    }

    for (const tier of ["rerank", "synthesis", "dailyInsight", "briefing"]) {
      aiCache.invalidateForOwner(tier, scope.ownerId);
    }
    for (const id of affectedIds) {
      scheduleSearchIndex(id);
    }

    return { affected: affectedIds.length };
  },

  deleteTag(scope: Scope, tag: string): { affected: number } {
    const targetTag = tag.trim();
    if (!targetTag) return { affected: 0 };

    let affectedIds: string[] = [];
    sqlite.transaction(() => {
      const rows = _stmts.contactsWithTag.all(
        scope.ownerId,
        targetTag,
      ) as Array<{
        contactId: string;
      }>;
      if (rows.length === 0) {
        return;
      }
      affectedIds = rows.map((r) => r.contactId);

      _stmts.deleteTagForOwner.run(targetTag, scope.ownerId);
      for (const id of affectedIds) {
        _stmts.touchContact.run(id, scope.ownerId);
      }
    })();

    if (affectedIds.length === 0) {
      return { affected: 0 };
    }

    for (const tier of ["rerank", "synthesis", "dailyInsight", "briefing"]) {
      aiCache.invalidateForOwner(tier, scope.ownerId);
    }
    for (const id of affectedIds) {
      scheduleSearchIndex(id);
    }

    return { affected: affectedIds.length };
  },
};
