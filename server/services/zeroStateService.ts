/**
 * Zero-State Service — Deterministic CRM intelligence for the Cmd+K zero-state.
 *
 * All queries are pure SQLite with prepared statements. No AI calls, no external
 * APIs. Target latency: < 10ms total. The payload powers the "intelligent
 * zero-state" that appears when the command palette opens with an empty input.
 *
 * @module server/services/zeroStateService
 */
import { describePastDue } from "../../shared/pastDue.ts";
import { sqlite } from "../db.ts";
import { CATCH_UP_DAYS_SINCE, CATCH_UP_WHERE } from "./catchUp.ts";
import { log } from "../utils/logger.ts";
import type { Scope } from "../tenancy/scope.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ZeroStateInsight {
  type: "action_items" | "catch_up" | "ghost" | "stale_data" | "dedupe";
  label: string;
  count?: number;
  contact?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  /** A catch-up: days since the clock, and how far past the cadence. */
  daysSince?: number;
  overshootDays?: number;
  mentionCount?: number;
}

export interface ZeroStatePayload {
  insights: ZeroStateInsight[];
}

// ─── Prepared Statements (cached on first call) ──────────────────────────────
// Five statements, each taking the owner as its first bound parameter. The
// dedupe count reads `dedupe_suggestions.ownerId` directly rather than joining
// back to contacts, because a suggestion names two contacts and both share the
// owner by the mismatch trigger.
//
// A catch-up is a tracked contact past its cadence: the same rule as the
// Catch up group on Pulse, from `catchUp.ts`, so the two never disagree about
// who needs a call. The two furthest past due are the palette's signal.

const stmts = {
  urgentCount: sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM action_items ai
    JOIN contacts c ON ai.contactId = c.id
    WHERE ai.ownerId = ?
      AND ai.completedAt IS NULL
      AND date(ai.dueAt) <= date('now')
      AND (c.isArchived = 0 OR c.isArchived IS NULL)
  `),

  catchUp: sqlite.prepare(`
    SELECT c.id, c.name, c.avatarUrl,
           ${CATCH_UP_DAYS_SINCE} as daysSince,
           (${CATCH_UP_DAYS_SINCE} - c.cadenceDays) as overshootDays
    FROM contacts c
    WHERE c.ownerId = ? AND ${CATCH_UP_WHERE}
    ORDER BY overshootDays DESC, c.name ASC
    LIMIT 2
  `),

  topGhost: sqlite.prepare(`
    SELECT c.id, c.name, c.avatarUrl,
           COUNT(DISTINCT im.interactionId) as mentionCount
    FROM contacts c
    JOIN interaction_mentions im ON c.id = im.contactId
    WHERE c.ownerId = ?
      AND c.isGhost = 1
      AND (c.isArchived = 0 OR c.isArchived IS NULL)
    GROUP BY c.id
    ORDER BY mentionCount DESC
    LIMIT 1
  `),

  staleCount: sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM contacts
    WHERE ownerId = ?
      AND updatedAt < date('now', '-6 months')
      AND isGhost = 0
      AND (isArchived = 0 OR isArchived IS NULL)
      AND canonicalId IS NULL
  `),

  pendingDedupeCount: sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM dedupe_suggestions
    WHERE ownerId = ? AND status = 'pending'
  `),
};

// ─── Service ─────────────────────────────────────────────────────────────────

export const zeroStateService = {
  /**
   * Compute the zero-state intelligence payload.
   * All queries are idempotent and read-only. Safe to call on every Cmd+K open.
   */
  getPayload(scope: Scope): ZeroStatePayload {
    const startMs = Date.now();
    const insights: ZeroStateInsight[] = [];

    // 1. Action items (overdue + due today)
    const urgent = stmts.urgentCount.get(scope.ownerId) as { count: number };
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

    // 2. Catch-ups: tracked contacts past their cadence, the two furthest
    const catchUpRows = stmts.catchUp.all(scope.ownerId) as {
      id: string;
      name: string;
      avatarUrl: string | null;
      daysSince: number;
      overshootDays: number;
    }[];
    for (const row of catchUpRows) {
      insights.push({
        type: "catch_up",
        label: `${row.name}, ${describePastDue(row.overshootDays)}`,
        contact: { id: row.id, name: row.name, avatarUrl: row.avatarUrl },
        daysSince: row.daysSince,
        overshootDays: row.overshootDays,
      });
    }

    // 3. Ghost alert (frequently mentioned but not a real contact)
    const ghost = stmts.topGhost.get(scope.ownerId) as
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
    const stale = stmts.staleCount.get(scope.ownerId) as { count: number };
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
    const dedupe = stmts.pendingDedupeCount.get(scope.ownerId) as {
      count: number;
    };
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
