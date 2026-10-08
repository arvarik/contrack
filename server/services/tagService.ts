// Tags as a vocabulary: a person thinks of tags across contacts, so this gives
// them counts and actions.
//
//   getSummary   distinct tags, the contacts in the list that hold each, and
//                every contact a rename or a delete changes
//   renameTag    rename, merging into an existing tag, across the owner's
//                contacts
//   deleteTag    remove a tag from all of this account's contacts
//
// Each runs in one transaction, scoped through contacts.ownerId.

import { sqlite } from "../db.ts";
import type { TagSummary } from "../../shared/contracts/tags.ts";
import type { Scope } from "../tenancy/scope.ts";
import { aiCache } from "../utils/aiCache.ts";
import { scheduleSearchIndex } from "./search/indexQueue.ts";

/** After a rename or delete changed these contacts: drop cached answers, reindex. */
function afterTagChange(scope: Scope, ids: string[]): { affected: number } {
  if (ids.length === 0) return { affected: 0 };
  for (const tier of ["rerank", "synthesis", "dailyInsight", "briefing"]) {
    aiCache.invalidateForOwner(tier, scope.ownerId);
  }
  for (const id of ids) scheduleSearchIndex(id);
  return { affected: ids.length };
}

const _stmts = {
  // `count` is the contacts the Network list shows. A rename and a delete
  // change every contact with the tag, archived and trashed ones too, and
  // `total` counts those, so the dialogs can say so.
  summary: sqlite.prepare(`
    SELECT ct.tag,
           COUNT(DISTINCT CASE
             WHEN (c.isArchived = 0 OR c.isArchived IS NULL) AND c.deletedAt IS NULL
             THEN ct.contactId END) AS count,
           COUNT(DISTINCT ct.contactId) AS total
      FROM contact_tags ct
      JOIN contacts c ON c.id = ct.contactId
     WHERE c.ownerId = ?
     GROUP BY ct.tag
    HAVING count > 0
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
  getSummary(scope: Scope): TagSummary[] {
    return _stmts.summary.all(scope.ownerId) as TagSummary[];
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

    return afterTagChange(scope, affectedIds);
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

    return afterTagChange(scope, affectedIds);
  },
};
