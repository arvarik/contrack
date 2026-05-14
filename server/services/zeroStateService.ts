/**
 * Zero-State Service — Deterministic CRM intelligence for the Cmd+K zero-state.
 *
 * All queries are pure SQLite with prepared statements. No AI calls, no external
 * APIs. Target latency: < 10ms total. The payload powers the "intelligent
 * zero-state" that appears when the command palette opens with an empty input.
 *
 * @module server/services/zeroStateService
 */
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ZeroStateInsight {
  type: "action_items" | "at_risk" | "ghost" | "stale_data" | "dedupe";
  label: string;
  count?: number;
  contact?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  daysSince?: number;
  score?: number;
  mentionCount?: number;
}

export interface ZeroStatePayload {
  insights: ZeroStateInsight[];
}

// ─── Prepared Statements (cached on first call) ──────────────────────────────

const stmts = {
  urgentCount: sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM action_items ai
    JOIN contacts c ON ai.contactId = c.id
    WHERE ai.completedAt IS NULL
      AND date(ai.dueAt) <= date('now')
      AND (c.isArchived = 0 OR c.isArchived IS NULL)
  `),

  atRisk: sqlite.prepare(`
    SELECT c.id, c.name, c.avatarUrl, c.relationshipScore,
           CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) as daysSince
    FROM contacts c
    WHERE c.isGhost = 0
      AND (c.isArchived = 0 OR c.isArchived IS NULL)
      AND c.relationshipScore < 40
      AND c.lastContactedAt IS NOT NULL
      AND CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) > 30
    ORDER BY c.relationshipScore ASC
    LIMIT 2
  `),

  topGhost: sqlite.prepare(`
    SELECT c.id, c.name, c.avatarUrl,
           COUNT(DISTINCT im.interactionId) as mentionCount
    FROM contacts c
    JOIN interaction_mentions im ON c.id = im.contactId
    WHERE c.isGhost = 1
      AND (c.isArchived = 0 OR c.isArchived IS NULL)
    GROUP BY c.id
    ORDER BY mentionCount DESC
    LIMIT 1
  `),

  staleCount: sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM contacts
    WHERE updatedAt < date('now', '-6 months')
      AND isGhost = 0
      AND (isArchived = 0 OR isArchived IS NULL)
      AND canonicalId IS NULL
  `),

  pendingDedupeCount: sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM dedupe_suggestions
    WHERE status = 'pending'
  `),
};

// ─── Service ─────────────────────────────────────────────────────────────────

export const zeroStateService = {
  /**
   * Compute the zero-state intelligence payload.
   * All queries are idempotent and read-only. Safe to call on every Cmd+K open.
   */
  getPayload(): ZeroStatePayload {
    const startMs = Date.now();
    const insights: ZeroStateInsight[] = [];

    // 1. Action items (overdue + due today)
    const urgent = stmts.urgentCount.get() as { count: number };
    if (urgent.count > 0) {
      insights.push({
        type: "action_items",
        label:
          urgent.count === 1
            ? "1 follow-up due"
            : `${urgent.count} follow-ups due`,
        count: urgent.count,
      });
    }

    // 2. At-risk contacts (low score + long silence)
    const atRiskRows = stmts.atRisk.all() as {
      id: string;
      name: string;
      avatarUrl: string | null;
      relationshipScore: number;
      daysSince: number;
    }[];
    for (const row of atRiskRows) {
      insights.push({
        type: "at_risk",
        label: `${row.name} — ${row.daysSince}d since last contact`,
        contact: { id: row.id, name: row.name, avatarUrl: row.avatarUrl },
        daysSince: row.daysSince,
        score: row.relationshipScore,
      });
    }

    // 3. Ghost alert (frequently mentioned but not a real contact)
    const ghost = stmts.topGhost.get() as
      | {
          id: string;
          name: string;
          avatarUrl: string | null;
          mentionCount: number;
        }
      | undefined;
    if (ghost && ghost.mentionCount >= 2) {
      insights.push({
        type: "ghost",
        label: `${ghost.name} mentioned ${ghost.mentionCount}× — not in your network`,
        contact: { id: ghost.id, name: ghost.name, avatarUrl: ghost.avatarUrl },
        mentionCount: ghost.mentionCount,
      });
    }

    // 4. Stale data indicator (contacts with updatedAt > 6 months)
    const stale = stmts.staleCount.get() as { count: number };
    if (stale.count > 0) {
      insights.push({
        type: "stale_data",
        label:
          stale.count === 1
            ? "1 contact has stale data"
            : `${stale.count} contacts have stale data`,
        count: stale.count,
      });
    }

    // 5. Pending dedupe suggestions
    const dedupe = stmts.pendingDedupeCount.get() as { count: number };
    if (dedupe.count > 0) {
      insights.push({
        type: "dedupe",
        label:
          dedupe.count === 1
            ? "1 potential duplicate detected"
            : `${dedupe.count} potential duplicates detected`,
        count: dedupe.count,
      });
    }

    const elapsed = Date.now() - startMs;
    log.debug(
      "ZeroState",
      `Computed zero-state payload in ${elapsed}ms (${insights.length} insights)`,
    );

    return { insights };
  },
};
