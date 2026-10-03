// =============================================================================
// MCP Service — the read-only surface an MCP client or a personal token asks
// =============================================================================
// Five queries, one account. Every one of them names the caller's owner, so an
// MCP client signed in with one account's personal token reads that account's
// contacts and nothing else. The principal a token produces is an ordinary
// user principal, so `scopeOf(req)` answers for a token exactly as it answers
// for a browser session.
// =============================================================================

import { sqlite } from "../db.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import type { Scope } from "../tenancy/scope.ts";
import { normalizePhone } from "../utils/nlp/phone.ts";

/** A contact the app shows: not a ghost, not in the trash, not merged away. */
const IN_NETWORK =
  "c.deletedAt IS NULL AND c.isGhost = 0 AND c.canonicalId IS NULL";

/** One contact that holds an email or a phone the caller asked about. */
export interface ContactMatch {
  id: string;
  name: string;
  isArchived: boolean;
  /** The email or the phone, as the contact holds it. */
  matched: string;
}

export const mcpService = {
  /**
   * The caller's contacts, filtered and paged.
   *
   * Filters active rows: excludes trashed contacts, ghosts, and the losing side
   * of a merge, so an MCP client never sees people the user had deleted, stubs
   * the app never shows, or duplicates the app had already retired. `softMergeContacts`
   * sets `canonicalId` and nothing else, so that third filter is what excludes a
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
      updatedSince?: string;
      /** True for the people the account keeps up with, false for the rest. */
      tracked?: boolean;
      location?: string;
      /** A tag, without regard to case. */
      tag?: string;
      /** A list's ID, or its whole name without regard to case. */
      list?: string;
      /** Exact, as `findByEmailOrPhone` matches it. */
      email?: string;
      /** By its digits, as `findByEmailOrPhone` matches it. */
      phone?: string;
    },
  ) {
    let q = `SELECT * FROM contacts
        WHERE ownerId = ? AND deletedAt IS NULL AND isGhost = 0
          AND canonicalId IS NULL`;
    const params: (string | number)[] = [scope.ownerId];

    for (const ids of [
      options.email === undefined
        ? null
        : mcpService.findByEmailOrPhone(scope, [options.email], []),
      options.phone === undefined
        ? null
        : mcpService.findByEmailOrPhone(scope, [], [options.phone]),
    ]) {
      if (!ids) continue;
      if (ids.length === 0) return [];
      q += ` AND id IN (${ids.map(() => "?").join(",")})`;
      params.push(...ids.map((match) => match.id));
    }

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
    if (options.updatedSince) {
      q += " AND updatedAt >= ?";
      params.push(options.updatedSince);
    }
    if (options.tracked !== undefined) {
      q += " AND isTracked = ?";
      params.push(options.tracked ? 1 : 0);
    }
    if (options.location) {
      q += " AND location LIKE ?";
      params.push(`%${options.location}%`);
    }
    if (options.tag) {
      q += ` AND EXISTS (SELECT 1 FROM contact_tags t
               WHERE t.contactId = contacts.id AND t.tag = ? COLLATE NOCASE)`;
      params.push(options.tag.trim());
    }
    if (options.list) {
      // `list_members` has no owner, so the list's owner is checked here.
      q += ` AND EXISTS (SELECT 1 FROM list_members lm JOIN lists l ON l.id = lm.listId
               WHERE lm.contactId = contacts.id AND l.ownerId = ?
                 AND (l.id = ? OR l.name = ? COLLATE NOCASE))`;
      params.push(scope.ownerId, options.list, options.list.trim());
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

  /**
   * The caller's contacts that hold one of these emails or phones.
   *
   * It reads the contacts that list_contacts reads, archived ones included:
   * a second contact for an archived person is still a duplicate. An email
   * matches without regard to case or the spaces around it. A phone matches
   * on its digits through `normalizePhone`, as a connector matches one, so
   * "+1 (415) 555-0100" finds "415-555-0100". One row for each match.
   */
  findByEmailOrPhone(
    scope: Scope,
    emails: string[],
    phones: string[],
  ): ContactMatch[] {
    const matches: ContactMatch[] = [];
    const toMatch = (row: {
      id: string;
      name: string;
      isArchived: number | null;
      matched: string;
    }): ContactMatch => ({ ...row, isArchived: row.isArchived === 1 });

    const wanted = [
      ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
    ];
    if (wanted.length > 0) {
      const rows = sqlite
        .prepare(
          `SELECT c.id, c.name, c.isArchived, ce.email AS matched
             FROM contact_emails ce JOIN contacts c ON c.id = ce.contactId
            WHERE c.ownerId = ? AND ${IN_NETWORK}
              AND LOWER(TRIM(ce.email)) IN (${wanted.map(() => "?").join(",")})`,
        )
        .all(scope.ownerId, ...wanted) as Parameters<typeof toMatch>[0][];
      matches.push(...rows.map(toMatch));
    }

    const digits = new Set(phones.map(normalizePhone).filter(Boolean));
    if (digits.size > 0) {
      // The stored phones keep the shape they were typed in, so the digits
      // are compared here rather than in SQL. One account holds a few
      // thousand phones at most.
      const rows = sqlite
        .prepare(
          `SELECT c.id, c.name, c.isArchived, cp.phone AS matched
             FROM contact_phones cp JOIN contacts c ON c.id = cp.contactId
            WHERE c.ownerId = ? AND ${IN_NETWORK}`,
        )
        .all(scope.ownerId) as Parameters<typeof toMatch>[0][];
      for (const row of rows) {
        if (digits.has(normalizePhone(row.matched))) matches.push(toMatch(row));
      }
    }
    return matches;
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
             isTracked = 1 AND cadenceDays > 0 AND
             datetime(COALESCE(lastContactedAt, trackedAt), '+' || cadenceDays || ' days') <= ?
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
