// =============================================================================
// Maintenance Service — the daily sweep of rows nothing else removes
// =============================================================================
// Five tables accumulate rows that no request ever deletes: audit entries past
// their retention, sessions whose expiry passed, tokens revoked long enough
// ago that nobody is going to ask about them, invitations that were revoked
// or expired a month back, and AI invocations outside the stats window.
//
// Before Phase 3 there was nothing to attach this to. `cleanupOldInvocations`
// ran once at boot and the session sweep was boot-only, so an instance left
// running for a year swept twice.
//
// The plan puts the `setInterval` in `server.ts`. It is here instead, with
// `server.ts` calling `startDailyMaintenance()`, for one reason: a test can
// call this and cannot call `server.ts`, which boots an HTTP server and a
// Vite instance. The gate and the schedule are what a reader wants to see in
// one place anyway, and `server.ts` keeps its own early return for the same
// environment variable.
// =============================================================================

import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { cleanupOldInvocations } from "./aiStatsService.ts";

/** How long each kind of row is kept. */
export const AUDIT_RETENTION_DAYS = 90;
export const REVOKED_TOKEN_RETENTION_DAYS = 30;
export const DEAD_INVITATION_RETENTION_DAYS = 30;

export interface MaintenanceCounts {
  auditRows: number;
  expiredSessions: number;
  agedTokens: number;
  deadInvitations: number;
  oldInvocations: number;
}

/**
 * Remove what nobody needs any more, and say how much went.
 *
 * Every cut-off is computed by SQLite rather than by JavaScript, so the
 * comparison is between two values in the same format that the columns are
 * stored in. Mixing an ISO string from `new Date()` with a
 * `CURRENT_TIMESTAMP` column compares `2026-09-10T05:33:50.050Z` against
 * `2026-09-10 05:33:50`, and the `T` sorts after a space, which quietly makes
 * every cut-off a day out.
 *
 * Never throws. A sweep that fails is a warning in the log and a retry
 * tomorrow, not a reason to take the process down.
 */
export function runDailyMaintenance(): MaintenanceCounts {
  const counts: MaintenanceCounts = {
    auditRows: 0,
    expiredSessions: 0,
    agedTokens: 0,
    deadInvitations: 0,
    oldInvocations: 0,
  };

  try {
    counts.auditRows = sqlite
      .prepare(
        `DELETE FROM audit_log
          WHERE createdAt < datetime('now', ?)`,
      )
      .run(`-${AUDIT_RETENTION_DAYS} days`).changes;

    counts.expiredSessions = sqlite
      .prepare(`DELETE FROM sessions WHERE expiresAt <= datetime('now')`)
      .run().changes;

    // A revoked token ages out. An expired one stays, because the list is
    // where somebody looks to understand why their script stopped working,
    // and "expired three weeks ago" is the answer they need to see.
    counts.agedTokens = sqlite
      .prepare(
        `DELETE FROM api_tokens
          WHERE revokedAt IS NOT NULL AND revokedAt < datetime('now', ?)`,
      )
      .run(`-${REVOKED_TOKEN_RETENTION_DAYS} days`).changes;

    // Revoked or expired, and old enough that the admin who issued it has
    // stopped wondering. An accepted invitation is kept: it is the record of
    // how somebody joined.
    counts.deadInvitations = sqlite
      .prepare(
        `DELETE FROM invitations
          WHERE acceptedAt IS NULL
            AND (revokedAt IS NOT NULL OR expiresAt < datetime('now'))
            AND createdAt < datetime('now', ?)`,
      )
      .run(`-${DEAD_INVITATION_RETENTION_DAYS} days`).changes;

    counts.oldInvocations = cleanupOldInvocations();
  } catch (err) {
    log.warn(
      "Maintenance",
      `Daily sweep failed part way through: ${getErrorMessage(err)}`,
    );
  }

  const total =
    counts.auditRows +
    counts.expiredSessions +
    counts.agedTokens +
    counts.deadInvitations +
    counts.oldInvocations;
  if (total > 0) {
    log.info(
      "Maintenance",
      `Daily sweep removed ${counts.auditRows} audit rows, ` +
        `${counts.expiredSessions} expired sessions, ` +
        `${counts.agedTokens} aged revoked tokens, ` +
        `${counts.deadInvitations} dead invitations, ` +
        `${counts.oldInvocations} old AI invocations`,
    );
  }
  return counts;
}

/**
 * Run the sweep now and every twenty-four hours after that.
 *
 * Gated by DISABLE_BACKGROUND_JOBS, which is the switch a Docker image or a
 * test harness sets to keep a booted instance from touching anything. The
 * interval is unrefed so it never holds the process open on its own.
 *
 * @returns the interval, or null when background jobs are off
 */
export function startDailyMaintenance(): ReturnType<typeof setInterval> | null {
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") {
    return null;
  }
  runDailyMaintenance();
  const timer = setInterval(runDailyMaintenance, 24 * 60 * 60 * 1000);
  // Fake timers in a test may not implement unref, and a missing unref costs
  // a test nothing.
  timer.unref?.();
  return timer;
}
