// =============================================================================
// Maintenance Service — the daily sweep of rows nothing else removes
// =============================================================================
// Five tables accumulate rows that no request ever deletes: audit entries past
// their retention, sessions whose expiry passed, tokens revoked long enough
// ago that nobody is going to ask about them, invitations that were revoked
// or expired a month back, and AI invocations outside the stats window.
//
// The sweep also checkpoints the write-ahead log, which is a different kind of
// growth with the same shape: nothing removes it in the ordinary course of
// things and it only becomes visible once it is a problem. `walHealth.ts` has
// the reasoning.
//
// The `setInterval` is managed here rather than in `server.ts`, with `server.ts`
// calling `startDailyMaintenance()`, so integration tests can test maintenance
// without booting the full HTTP server or Vite instance.
// =============================================================================

import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { cleanupOldInvocations } from "./aiStatsService.ts";
import { runWalMaintenance } from "./walHealth.ts";
import { isoWeekStart } from "../../shared/dates.ts";

/** How long each kind of row is kept. */
export const AUDIT_RETENTION_DAYS = 90;
export const REVOKED_TOKEN_RETENTION_DAYS = 30;
export const DEAD_INVITATION_RETENTION_DAYS = 30;
/**
 * How long a finished import is kept. Long enough to come back to a failed
 * row list after a holiday, short enough that a kept payload does not sit
 * around for ever. A running one is never swept: a process that dies leaves
 * it `running`, and the next read is what settles it.
 */
export const IMPORT_RETENTION_DAYS = 30;
export const AUTH_LINK_RETENTION_DAYS = 30;
export const SCORE_SNAPSHOT_RETENTION_WEEKS = 26;

export interface MaintenanceCounts {
  auditRows: number;
  expiredSessions: number;
  expiredChallenges: number;
  agedAuthLinks: number;
  agedTokens: number;
  deadInvitations: number;
  oldInvocations: number;
  /** Finished imports past retention, with their rows. */
  oldImports: number;
  /** Pruned score snapshots older than 26 weeks. */
  prunedScoreSnapshots: number;
  /** Pages the checkpoint moved back into the database. */
  walPagesCheckpointed: number;
}

/**
 * Remove what nobody needs any more, and say how much went.
 *
 * Every cut-off is computed by SQLite rather than by JavaScript, and every
 * column that might not be in SQLite's own format is read through
 * `datetime()`. Two of these columns are written by `new Date().toISOString()`
 * rather than by `CURRENT_TIMESTAMP`, and SQLite compares TEXT byte by byte:
 * `2026-09-10T15:41:07.774Z` against `2026-09-10 16:41:07` differs first at
 * the `T`, which sorts after a space, so a session that expired an hour ago
 * looked as though it had not. `datetime()` reads both formats, and a value it
 * cannot read becomes NULL, which keeps the row rather than removing one this
 * cannot reason about.
 *
 * Never throws. A sweep that fails is a warning in the log and a retry
 * tomorrow, not a reason to take the process down.
 */
export function runDailyMaintenance(): MaintenanceCounts {
  const counts: MaintenanceCounts = {
    auditRows: 0,
    expiredSessions: 0,
    expiredChallenges: 0,
    agedAuthLinks: 0,
    agedTokens: 0,
    deadInvitations: 0,
    oldInvocations: 0,
    oldImports: 0,
    prunedScoreSnapshots: 0,
    walPagesCheckpointed: 0,
  };

  try {
    counts.auditRows = sqlite
      .prepare(
        `DELETE FROM audit_log
          WHERE createdAt < datetime('now', ?)`,
      )
      .run(`-${AUDIT_RETENTION_DAYS} days`).changes;

    counts.expiredSessions = sqlite
      .prepare(
        `DELETE FROM sessions WHERE datetime(expiresAt) <= datetime('now')`,
      )
      .run().changes;

    counts.expiredChallenges = sqlite
      .prepare(
        `DELETE FROM auth_challenges WHERE datetime(expiresAt) <= datetime('now')`,
      )
      .run().changes;

    counts.agedAuthLinks = sqlite
      .prepare(
        `DELETE FROM auth_links
          WHERE (usedAt IS NOT NULL AND datetime(usedAt) < datetime('now', ?))
             OR (usedAt IS NULL AND datetime(expiresAt) < datetime('now', ?))`,
      )
      .run(
        `-${AUTH_LINK_RETENTION_DAYS} days`,
        `-${AUTH_LINK_RETENTION_DAYS} days`,
      ).changes;

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
            AND (revokedAt IS NOT NULL OR datetime(expiresAt) < datetime('now'))
            AND createdAt < datetime('now', ?)`,
      )
      .run(`-${DEAD_INVITATION_RETENTION_DAYS} days`).changes;

    counts.oldInvocations = cleanupOldInvocations();

    // Every account's, which is what a sweep is. `import_rows` goes with
    // each one through ON DELETE CASCADE.
    counts.oldImports = sqlite
      .prepare(
        // tenant-lint: allow instance sweep
        `DELETE FROM imports
          WHERE status IN ('complete', 'failed')
            AND datetime(updatedAt) < datetime('now', ?)`,
      )
      .run(`-${IMPORT_RETENTION_DAYS} days`).changes;

    const cutoffWeek = isoWeekStart(
      new Date(
        Date.now() - SCORE_SNAPSHOT_RETENTION_WEEKS * 7 * 24 * 60 * 60 * 1000,
      ),
    );
    counts.prunedScoreSnapshots = sqlite
      .prepare(
        // tenant-lint: allow instance sweep
        `DELETE FROM score_snapshots WHERE weekStart < ?`,
      )
      .run(cutoffWeek).changes;
  } catch (err) {
    log.warn(
      "Maintenance",
      `Daily sweep failed part way through: ${getErrorMessage(err)}`,
    );
  }

  // Outside the try above on purpose. A delete that throws must not take the
  // checkpoint with it: the two have nothing to do with each other beyond
  // sharing a schedule, and the WAL is the one that grows without bound.
  counts.walPagesCheckpointed = runWalMaintenance()?.checkpointedPages ?? 0;

  const total =
    counts.auditRows +
    counts.expiredSessions +
    counts.expiredChallenges +
    counts.agedAuthLinks +
    counts.agedTokens +
    counts.deadInvitations +
    counts.oldInvocations +
    counts.oldImports +
    counts.prunedScoreSnapshots;
  if (total > 0) {
    log.info(
      "Maintenance",
      `Daily sweep removed ${counts.auditRows} audit rows, ` +
        `${counts.expiredSessions} expired sessions, ` +
        `${counts.expiredChallenges} expired challenges, ` +
        `${counts.agedAuthLinks} aged auth links, ` +
        `${counts.agedTokens} aged revoked tokens, ` +
        `${counts.deadInvitations} dead invitations, ` +
        `${counts.oldInvocations} old AI invocations, ` +
        `${counts.oldImports} old imports, ` +
        `${counts.prunedScoreSnapshots} old score snapshots`,
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
