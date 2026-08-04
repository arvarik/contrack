import { sqlite } from "../db.ts";
import { contactRepo } from "../repositories/contactRepository.ts";

export const mcpService = {
  queryContacts(options: {
    limit: number;
    offset: number;
    fields?: string;
    role?: string;
    company?: string;
    industry?: string;
  }) {
    let q = "SELECT * FROM contacts WHERE 1=1";
    const params: (string | number)[] = [];

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

  getActionItems() {
    const now = new Date().toISOString();
    const rows = sqlite
      .prepare(
        `
      SELECT * FROM contacts 
      WHERE 
        nextFollowUpAt <= ?
        OR (
           lastContactedAt IS NOT NULL AND cadenceDays > 0 AND 
           datetime(lastContactedAt, '+' || cadenceDays || ' days') <= ?
        )
      ORDER BY lastContactedAt ASC
    `,
      )
      .all(now, now);

    return contactRepo.hydrateMany(rows);
  },

  getTags() {
    return sqlite
      .prepare("SELECT DISTINCT tag FROM contact_tags ORDER BY tag ASC")
      .all() as { tag: string }[];
  },

  getIndustries() {
    return sqlite
      .prepare(
        "SELECT DISTINCT industry FROM contacts WHERE industry IS NOT NULL AND industry != '' ORDER BY industry ASC",
      )
      .all() as { industry: string }[];
  },

  searchInteractions(q: string, type?: string) {
    const safeQ = `%${q}%`;
    let sqlQuery = `
      SELECT i.*, c.name as contactName 
      FROM interactions i
      JOIN contacts c ON i.contactId = c.id
      WHERE (i.title LIKE ? OR i.content LIKE ?)
    `;
    const params: string[] = [safeQ, safeQ];

    if (type) {
      sqlQuery += " AND i.type = ?";
      params.push(type);
    }

    sqlQuery += " ORDER BY i.date DESC LIMIT 50";
    return sqlite.prepare(sqlQuery).all(...params);
  },

  getGlobalTimeline(limit: number, since?: string, type?: string) {
    let sqlQuery = `
      SELECT i.*, c.name as contactName, c.avatarUrl as contactAvatar, c.themeColor as contactThemeColor
      FROM interactions i
      JOIN contacts c ON i.contactId = c.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

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
