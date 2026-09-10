// =============================================================================
// MCP Service — the read-only surface an MCP client or a personal token asks
// =============================================================================
// Six queries, one account. Every one of them names the caller's owner, so an
// MCP client signed in with one account's personal token reads that account's
// contacts and nothing else. The principal a token produces is an ordinary
// user principal, so `scopeOf(req)` answers for a token exactly as it answers
// for a browser session.
// =============================================================================

import { sqlite } from "../db.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import type { Scope } from "../tenancy/scope.ts";

export const mcpService = {
  /**
   * The caller's contacts, filtered and paged.
   *
   * The active-row filters are new in sub-phase 2g. This query used to answer
   * with trashed contacts, ghosts and the losing side of a merge, so an MCP
   * client saw people the user had deleted, stubs the app never shows, and
   * duplicates the app had already retired. `softMergeContacts` sets
   * `canonicalId` and nothing else, so that third filter is what excludes a
   * merged row. Archived contacts stay: the app shows those on their own page.
   */
  queryContacts(
    scope: Scope,
    options: {
      limit: number;
      offset: number;
      fields?: string;
      role?: string;
      company?: string;
      industry?: string;
    },
  ) {
    let q = `SELECT * FROM contacts
        WHERE ownerId = ? AND deletedAt IS NULL AND isGhost = 0
          AND canonicalId IS NULL`;
    const params: (string | number)[] = [scope.ownerId];

    if (options.role) {
      q += " AND role LIKE ?";
      params.push(`%${options.role}%`);
    }
    if (options.company) {
      q += " AND company LIKE ?";
      params.push(`%${options.company}%`);
    }
    if (options.industry) {
      q += " AND industry = ?";
      params.push(options.industry);
    }

    q += " ORDER BY addedAt DESC LIMIT ? OFFSET ?";
    params.push(options.limit, options.offset);

    // Dynamic field projection below requires string-keyed access — rows are
    // treated as generic records rather than a fixed contact shape.
    let rows = sqlite.prepare(q).all(...params) as Record<string, unknown>[];

    if (options.fields) {
      const allowed = options.fields.split(",").map((f) => f.trim());
      rows = rows.map((r) => {
        const projected: Record<string, unknown> = {};
        for (const k of allowed) if (k in r) projected[k] = r[k];
        return projected;
      });
    }

    return rows;
  },

  /** The caller's contacts that are due for follow-up. */
  getActionItems(scope: Scope) {
    const now = new Date().toISOString();
    const rows = sqlite
      .prepare(
        `
      SELECT * FROM contacts
      WHERE ownerId = ?
        AND (
          nextFollowUpAt <= ?
          OR (
             lastContactedAt IS NOT NULL AND cadenceDays > 0 AND
             datetime(lastContactedAt, '+' || cadenceDays || ' days') <= ?
          )
        )
      ORDER BY lastContactedAt ASC
    `,
      )
      .all(scope.ownerId, now, now);

    return contactRepo.hydrateMany(rows);
  },

  /**
   * Every tag the caller uses.
   *
   * `contact_tags` carries no owner of its own, so the join to `contacts` is
   * what makes this one account's list. Reading the child table alone returned
   * the tag vocabulary of everybody on the instance.
   */
  getTags(scope: Scope) {
    return sqlite
      .prepare(
        `SELECT DISTINCT ct.tag FROM contact_tags ct
           JOIN contacts c ON c.id = ct.contactId
          WHERE c.ownerId = ?
          ORDER BY ct.tag ASC`,
      )
      .all(scope.ownerId) as { tag: string }[];
  },

  /** Every industry the caller's contacts name. */
  getIndustries(scope: Scope) {
    return sqlite
      .prepare(
        `SELECT DISTINCT industry FROM contacts
          WHERE ownerId = ? AND industry IS NOT NULL AND industry != ''
          ORDER BY industry ASC`,
      )
      .all(scope.ownerId) as { industry: string }[];
  },

  /** The caller's interactions whose title or body contains `q`. */
  searchInteractions(scope: Scope, q: string, type?: string) {
    const safeQ = `%${q}%`;
    let sqlQuery = `
      SELECT i.*, c.name as contactName
      FROM interactions i
      JOIN contacts c ON i.contactId = c.id
      WHERE i.ownerId = ? AND (i.title LIKE ? OR i.content LIKE ?)
    `;
    const params: string[] = [scope.ownerId, safeQ, safeQ];

    if (type) {
      sqlQuery += " AND i.type = ?";
      params.push(type);
    }

    sqlQuery += " ORDER BY i.date DESC LIMIT 50";
    return sqlite.prepare(sqlQuery).all(...params);
  },

  /**
   * The caller's whole timeline, newest first.
   *
   * The owner predicate sits on `interactions`, which carries its own
   * `ownerId`, so this reads `idx_interactions_owner_date` rather than joining
   * first and filtering afterwards.
   */
  getGlobalTimeline(
    scope: Scope,
    limit: number,
    since?: string,
    type?: string,
  ) {
    let sqlQuery = `
      SELECT i.*, c.name as contactName, c.avatarUrl as contactAvatar, c.themeColor as contactThemeColor
      FROM interactions i
      JOIN contacts c ON i.contactId = c.id
      WHERE i.ownerId = ?
    `;
    const params: (string | number)[] = [scope.ownerId];

    if (since) {
      sqlQuery += " AND i.date >= ?";
      params.push(since);
    }

    if (type) {
      sqlQuery += " AND i.type = ?";
      params.push(type);
    }

    sqlQuery += " ORDER BY i.date DESC LIMIT ?";
    params.push(limit);

    return sqlite.prepare(sqlQuery).all(...params);
  },
};
