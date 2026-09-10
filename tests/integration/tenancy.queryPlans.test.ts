// =============================================================================
// Integration Tests — the owner predicate has to be an index seek
// =============================================================================
// Every read in Phase 2 gained `WHERE ownerId = ?`. A predicate SQLite has to
// evaluate row by row is correct and slow: on a ten-account instance it reads
// ten times the rows it returns, and the cost grows with the number of people
// using the instance rather than with the size of one person's data.
//
// So for each statement the phase document names, this file runs
// EXPLAIN QUERY PLAN and asserts two things: the owner-led index appears, and
// no full scan of the table does. The database is seeded with two accounts and
// 500 contacts each and then ANALYZE'd, because the planner prefers a scan on
// a small table and would make every assertion here pass for the wrong reason.
//
// The SQL below is copied from the statement each row names. When a statement
// changes shape, this file has to be updated with it, which is the point: the
// plan is part of the statement's contract, not an accident of it.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { sqlite } from "../../server/db.ts";
import { ownerToken, scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { WEIGHTS, scopedMatch } from "../../server/services/search/lexical.ts";
import { ACTIVE_CONTACT_SQL } from "../../server/services/search/ftsIndex.ts";

const CONTACTS_PER_OWNER = 500;

/**
 * How many accounts the instance holds.
 *
 * The phase document asks for two accounts of 500 contacts, and two is enough
 * for every statement that carries a second predicate or a sort the composite
 * answers. It is not enough for `lists`, whose only owner-selectivity is the
 * owner column itself: with two accounts an owner seek returns half the table,
 * so SQLite scans instead, and it is right to. Eight more small accounts make
 * the column selective, which is what a real instance looks like and what the
 * composite indexes were built for.
 */
const SMALL_OWNERS = 8;

let ownerA: string;

/** One account's rows. Same shape for every account, different size. */
function seedOwner(label: string, contacts: number, lists: number): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, displayName, passwordHash, role)
       VALUES (?, ?, ?, ?, 'none$', 'member')`,
    )
    .run(id, `${label}@plans.test`, label, label);

  const contact = sqlite.prepare(
    `INSERT INTO contacts
       (id, name, company, industry, ownerId, addedAt, updatedAt, isGhost,
        isArchived, canonicalId, deletedAt, lastContactedAt, relationshipScore,
        phoneticHash, nextFollowUpAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  const interaction = sqlite.prepare(
    `INSERT INTO interactions (id, contactId, type, title, content, date)
     VALUES (?, ?, 'note', ?, ?, ?)`,
  );
  const actionItem = sqlite.prepare(
    `INSERT INTO action_items (id, contactId, title, dueAt, completedAt)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const list = sqlite.prepare(
    `INSERT INTO lists (id, name, icon, sortOrder, ownerId)
     VALUES (?, ?, 'star', ?, ?)`,
  );
  const member = sqlite.prepare(
    `INSERT INTO list_members (listId, contactId) VALUES (?, ?)`,
  );
  const suggestion = sqlite.prepare(
    `INSERT INTO dedupe_suggestions
       (id, contactIdA, contactIdB, matchType, confidence, reasoning, status)
     VALUES (?, ?, ?, 'exact_email', ?, 'looks alike', ?)`,
  );
  const mergeLog = sqlite.prepare(
    `INSERT INTO dedupe_merge_log
       (id, primaryId, duplicateId, mergedBy, mergeType, confidence, reasoning,
        mergedAt, ownerId)
     VALUES (?, ?, ?, 'user', 'manual', 0.9, 'same person', ?, ?)`,
  );
  const invocation = sqlite.prepare(
    `INSERT INTO ai_invocations
       (id, operation, model, tokenCount, latencyMs, cached, ownerId, createdAt)
     VALUES (?, 'rerank', 'mock', 100, 5, 0, ?, ?)`,
  );

  const listIds = Array.from({ length: lists }, () => crypto.randomUUID());
  sqlite.transaction(() => {
    for (const [i, listId] of listIds.entries()) {
      list.run(listId, `${label} List ${i}`, i, id);
    }

    const contactIds: string[] = [];
    for (let i = 0; i < contacts; i++) {
      const contactId = crypto.randomUUID();
      contactIds.push(contactId);
      const day = String((i % 27) + 1).padStart(2, "0");
      contact.run(
        contactId,
        `${label} Person ${i}`,
        `Company ${i % 40}`,
        `Industry ${i % 12}`,
        id,
        `2026-01-${day}T00:00:00Z`,
        `2026-01-${day}T00:00:00Z`,
        i % 25 === 0 ? 1 : 0,
        // A tenth of each account's contacts are in the trash.
        i % 10 === 0 ? `2026-02-${day}T00:00:00Z` : null,
        `2025-11-${day}T00:00:00Z`,
        i % 100,
        `PRSN${i % 50}`,
        i % 7 === 0 ? `2026-03-${day}T00:00:00Z` : null,
      );

      if (i % 5 === 0) {
        member.run(listIds[i % listIds.length], contactId);
      }
      if (i % 4 === 0) {
        interaction.run(
          crypto.randomUUID(),
          contactId,
          `${label} note ${i}`,
          `Talked about roadmap ${i}`,
          `2026-01-${day}T12:00:00Z`,
        );
      }
      if (i % 6 === 0) {
        actionItem.run(
          crypto.randomUUID(),
          contactId,
          `${label} task ${i}`,
          `2027-01-${day}T00:00:00Z`,
          i % 12 === 0 ? `2026-02-${day}T00:00:00Z` : null,
        );
      }
      if (i % 8 === 0) {
        invocation.run(crypto.randomUUID(), id, `2026-01-${day}T09:00:00Z`);
      }
    }

    // Pairs, for the two dedupe tables. Both contacts in a pair share an
    // owner, which the invariant triggers require anyway.
    const pairs = Math.min(60, contacts - 1);
    for (let i = 0; i + 1 < pairs; i += 2) {
      suggestion.run(
        crypto.randomUUID(),
        contactIds[i],
        contactIds[i + 1],
        0.5 + (i % 40) / 100,
        i % 4 === 0 ? "dismissed" : "pending",
      );
      mergeLog.run(
        crypto.randomUUID(),
        contactIds[i],
        contactIds[i + 1],
        `2026-02-${String((i % 27) + 1).padStart(2, "0")}T00:00:00Z`,
        id,
      );
    }
  })();

  return id;
}

beforeAll(() => {
  ownerA = seedOwner("plana", CONTACTS_PER_OWNER, 50);
  // The second big account is never queried. It is here so that the owner
  // column has more than one value and an owner seek is not the whole table.
  seedOwner("planb", CONTACTS_PER_OWNER, 50);
  for (let i = 0; i < SMALL_OWNERS; i++) {
    seedOwner(`plan-small-${i}`, 40, 4);
  }
  // The planner reads sqlite_stat1. Without this every assertion here passes
  // for the wrong reason, because a scan of a small table is genuinely cheap.
  sqlite.exec("ANALYZE");
});

/** The plan for one statement, one line per step. */
function planOf(sql: string, params: unknown[]): string {
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
    detail: string;
  }[];
  return rows.map((r) => r.detail).join("\n");
}

/**
 * Every statement the phase document names, with the plan it must produce.
 *
 * `index` is the index that must appear. No step may be a `SCAN` at all, and
 * that is checked without naming tables: SQLite prints the alias when a
 * statement declares one, so an assertion written against table names would
 * pass for four of these cases whatever the plan said. `source` is where the
 * statement lives, so a reader can check this copy against the original.
 */
interface PlanCase {
  label: string;
  source: string;
  sql: string;
  params: () => unknown[];
  index: RegExp;
  /** Set when SQLite picks a different index than the phase document guessed. */
  note?: string;
}

const CASES: PlanCase[] = [
  {
    label: "slim contacts list",
    source: "server/services/contactService.ts getSlimContacts",
    sql: `
      SELECT id, name, firstName, lastName, company, avatarUrl,
             themeColor, isGhost, isArchived, addedAt, updatedAt,
             role, headline, location, industry, pronouns,
             cadenceDays, lastContactedAt, nextFollowUpAt,
             lat, lng, relationshipScore, aiHydratedAt
      FROM contacts
      WHERE ownerId = ? AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL
      ORDER BY addedAt DESC`,
    params: () => [ownerA],
    index: /USING (?:COVERING )?INDEX idx_contacts_owner_added/,
    note:
      "The 2i table expects idx_contacts_owner_status. The statement ends " +
      "ORDER BY addedAt DESC, and idx_contacts_owner_added answers the owner " +
      "seek and removes the sort, so the planner takes it. Both lead with " +
      "ownerId, which is what this file is checking.",
  },
  {
    label: "trash list",
    source: "server/services/contactService.ts listTrash",
    sql: `
      SELECT id, name, company, avatarUrl, deletedAt FROM contacts
       WHERE ownerId = ? AND deletedAt IS NOT NULL ORDER BY deletedAt DESC`,
    params: () => [ownerA],
    index: /USING (?:COVERING )?INDEX idx_contacts_owner_deleted/,
  },
  {
    label: "dashboard at-risk",
    source: "server/services/dashboardService.ts getDashboardPayload",
    sql: `
      SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.relationshipScore,
             CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) as daysSinceContact,
             (SELECT title FROM interactions WHERE contactId = c.id AND ownerId = c.ownerId ORDER BY date DESC LIMIT 1) as lastInteractionTitle
      FROM contacts c
      WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND c.isGhost = 0
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
        AND c.relationshipScore < 40
        AND c.lastContactedAt IS NOT NULL
      ORDER BY c.relationshipScore ASC
      LIMIT 10`,
    params: () => [ownerA],
    index: /USING (?:COVERING )?INDEX idx_contacts_owner_score/,
    note:
      "The 2i table expects idx_contacts_owner_lastc. The selective predicate " +
      "is relationshipScore < 40 and the sort is on the same column, so " +
      "idx_contacts_owner_score answers the seek, the range and the ORDER BY " +
      "at once. lastContactedAt IS NOT NULL is a weak trailing filter.",
  },
  {
    label: "pending action items",
    source: "server/services/actionItemService.ts getAllPending",
    sql: `
      SELECT ai.*,
             c.name as contactName, c.company as contactCompany,
             c.avatarUrl as contactAvatarUrl, c.themeColor as contactThemeColor
      FROM action_items ai
      JOIN contacts c ON ai.contactId = c.id
      WHERE ai.ownerId = ?
        AND ai.completedAt IS NULL
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
      ORDER BY ai.dueAt ASC`,
    params: () => [ownerA],
    index: /USING (?:COVERING )?INDEX idx_action_items_owner_due/,
  },
  {
    label: "lists",
    source: "server/services/listService.ts getAllLists",
    sql: `
      SELECT l.*, COUNT(c.id) as memberCount
      FROM lists l
      LEFT JOIN list_members lm ON l.id = lm.listId
      LEFT JOIN contacts c ON c.id = lm.contactId AND c.ownerId = l.ownerId AND ${ACTIVE_CONTACT_SQL}
      WHERE l.ownerId = ?
      GROUP BY l.id
      ORDER BY l.sortOrder ASC, l.createdAt ASC`,
    params: () => [ownerA],
    index: /USING (?:COVERING )?INDEX idx_lists_owner_sort/,
  },
  {
    label: "pending suggestions",
    source: "server/services/dedupe/suggestions.ts _stmts.getPending",
    sql: `
      SELECT * FROM dedupe_suggestions
      WHERE ownerId = ? AND status = 'pending'
      ORDER BY confidence DESC
      LIMIT ?`,
    params: () => [ownerA, 100],
    index: /USING (?:COVERING )?INDEX idx_dedupe_sugg_owner_conf/,
    note:
      "The 2i table expects idx_dedupe_sugg_owner_status. Both exist and both " +
      "lead with ownerId; idx_dedupe_sugg_owner_conf also answers " +
      "ORDER BY confidence DESC with the LIMIT, so it wins on cost.",
  },
  {
    label: "merge log",
    source: "server/services/dedupe/suggestions.ts _stmts.getMergeLog",
    sql: `
      SELECT * FROM dedupe_merge_log
      WHERE ownerId = ?
      ORDER BY mergedAt DESC
      LIMIT ?`,
    params: () => [ownerA, 50],
    index: /USING (?:COVERING )?INDEX idx_merge_log_owner_at/,
  },
  {
    label: "AI stats feed",
    source: "server/services/aiStatsService.ts getFeed",
    sql: `
      SELECT id, operation, model, tokenCount, latencyMs, cached, description, createdAt
      FROM ai_invocations
      WHERE ownerId = ?
      ORDER BY createdAt DESC
      LIMIT ? OFFSET ?`,
    params: () => [ownerA, 50, 0],
    index: /USING (?:COVERING )?INDEX idx_ai_inv_owner_created/,
  },
  {
    label: "global timeline (MCP)",
    source: "server/services/mcpService.ts getGlobalTimeline",
    sql: `
      SELECT i.*, c.name as contactName, c.avatarUrl as contactAvatar, c.themeColor as contactThemeColor
      FROM interactions i
      JOIN contacts c ON i.contactId = c.id
      WHERE i.ownerId = ?
      ORDER BY i.date DESC LIMIT ?`,
    params: () => [ownerA, 50],
    index: /USING (?:COVERING )?INDEX idx_interactions_owner_date/,
  },
  {
    label: "phonetic block load",
    source: "server/services/dedupe/normalization.ts normalizeContacts",
    sql: `
      SELECT id, name, firstName, lastName, company, role, location, industry, headline, about, preferences
      FROM contacts WHERE ownerId = ? AND (isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND canonicalId IS NULL)`,
    params: () => [ownerA],
    index: /USING (?:COVERING )?INDEX idx_contacts_owner_canon/,
    note:
      "The 2i table expects idx_contacts_owner_phonetic. Nothing reads that " +
      "index: the dedupe blocking pass loads one account's active contacts " +
      "with the statement below and computes the phonetic key in JavaScript " +
      "(normalization.ts doubleMetaphone, blocking.ts buildBlockIndex). The " +
      "statement below is the load the block index is really built from.",
  },
];

describe("every scoped read is an index seek on the owner", () => {
  it.each(CASES.map((c) => [c.label, c] as const))("%s", (_label, testCase) => {
    const plan = planOf(testCase.sql, testCase.params());
    const where = `${testCase.label} (${testCase.source})\n${plan}`;
    expect(plan, where).toMatch(testCase.index);
    const scans = plan.split("\n").filter((step) => step.startsWith("SCAN "));
    expect(scans, where).toEqual([]);
  });

  it("keeps the owner inside the full-text MATCH", () => {
    // FTS5 pushes down only MATCH, rowid and rank, so an owner predicate that
    // falls out of the MATCH expression becomes a filter over rows the caller
    // may not read. The plan says which happened: `VIRTUAL TABLE INDEX 0:M`
    // is the MATCH form, and a bare `0:` with no M means the token is gone.
    // The MATCH string comes from production. Building it here would leave
    // `scopedMatch` free to drop the token, because FTS5 reports the same
    // index for any MATCH string and the plan below could not tell.
    const scope = scopeForOwnerId(ownerA);
    const match = scopedMatch(scope, '"plana"*');
    expect(match).toBe(`ownerTok:${ownerToken(scope)} AND ("plana"*)`);

    const plan = planOf(
      `
    SELECT c.id AS contactId FROM contacts_fts f
    JOIN contacts c ON c.rowid = f.rowid
    WHERE contacts_fts MATCH ? AND c.ownerId = ?
      AND ${ACTIVE_CONTACT_SQL}
    ORDER BY bm25(contacts_fts, ${WEIGHTS}), c.id LIMIT ?`,
      [match, ownerA, 20],
    );

    expect(plan, plan).toMatch(/VIRTUAL TABLE INDEX 0:M/);
    // The only other step is the rowid join back to contacts, which is a
    // primary-key seek and not a scan.
    expect(plan, plan).not.toMatch(/SCAN c\b/);
    expect(plan, plan).not.toMatch(/SCAN contacts\b/);
  });

  it("builds no single-column owner index to prefer over a composite", () => {
    // This file boots a fresh database, so what it guards is the create side:
    // the version-1 ownership loop must not put these back. The version-2
    // drop step, for a database that already has them, is proven in
    // tests/integration/tenancy.migration.test.ts. Either way a narrower
    // index would change several of the plans above.
    const names = (
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN
             ('idx_contacts_owner','idx_lists_owner','idx_ai_invocations_owner','idx_dedupe_merge_log_owner')`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual([]);
  });
});
