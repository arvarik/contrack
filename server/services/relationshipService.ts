/**
 * Relationship scores for tracked contacts, 0 to 100:
 *   Score = 0.40·Recency + 0.25·Frequency + 0.15·Depth + 0.10·Reciprocity + 0.10·Momentum
 * stored on `contacts.relationshipScore` for fast reads.
 *
 * Recomputed:
 * - when an interaction is created (one contact, at once)
 * - at startup and every 60 minutes (only what changed, per owner)
 * - every 24 hours (every contact, because recency decays with the clock)
 *
 * Two sweeps, because four of the five signals move only on a write, while
 * recency moves every day for every contact: a dirty-only sweep would freeze
 * the score of the person nobody has touched, the one the score exists to
 * surface. The hourly pass reads `contacts.scoreDirty`, which triggers on
 * `contacts`, `interactions` and `action_items` set (server/db.ts), and the
 * daily pass reads everything. On a quiet instance the hourly pass scans an
 * empty partial index.
 *
 * Both sweeps take owners in turn, a batch each, then yield to the event loop,
 * so an account with fifty thousand contacts cannot hold up one with fifty or a
 * waiting request, and each transaction stays inside one account.
 *
 * @module server/services/relationshipService
 */
import type { ScoreBreakdown } from "../../shared/contracts/contacts.ts";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { isoWeekStart } from "../../shared/dates.ts";
import { getPreferences } from "./userPreferencesService.ts";

// Types

interface ContactScoreRow {
  id: string;
  cadenceDays: number | null;
  lastContactedAt: string | null;
}

/** The row a single-contact read takes: the score inputs plus the two gates. */
interface ContactScoreTarget extends ContactScoreRow {
  ownerId?: string | null;
  isTracked: number;
}

interface InteractionStatsRow {
  total90d: number;
  total30d: number;
  totalPrev30d: number;
  bidirectionalCount: number;
  totalTypeCount: number;
  avgContentLength: number;
}

// Scoring

/**
 * Sigmoid decay for recency: near 100 within the cadence, steep after it.
 * k=0.08 does not punish a delay of a day or two too hard.
 */
function recencyScore(daysSinceContact: number, cadenceDays: number): number {
  if (daysSinceContact <= 0) return 100;
  const k = 0.08;
  return 100 / (1 + Math.exp(k * (daysSinceContact - cadenceDays)));
}

const WEIGHTS = {
  recency: 0.4,
  frequency: 0.25,
  depth: 0.15,
  reciprocity: 0.1,
  momentum: 0.1,
} as const;

/**
 * The per-contact interaction rollup, prepared once per process rather than per
 * contact. Lazy, because the unit project replaces `server/db.ts` with a stub.
 */
let statsStmt: ReturnType<typeof sqlite.prepare> | null = null;

function statsStatement() {
  statsStmt ??= sqlite.prepare(
    // tenant-lint: allow owner-checked by caller
    `SELECT
       COALESCE(SUM(CASE WHEN date >= date('now', '-90 days') THEN 1 ELSE 0 END), 0) as total90d,
       COALESCE(SUM(CASE WHEN date >= date('now', '-30 days') THEN 1 ELSE 0 END), 0) as total30d,
       COALESCE(SUM(CASE WHEN date >= date('now', '-60 days') AND date < date('now', '-30 days') THEN 1 ELSE 0 END), 0) as totalPrev30d,
       COALESCE(SUM(CASE WHEN type IN ('meeting', 'call', 'email') THEN 1 ELSE 0 END), 0) as bidirectionalCount,
       COUNT(*) as totalTypeCount,
       COALESCE(AVG(CASE WHEN content IS NOT NULL AND content != '' THEN LENGTH(content) ELSE NULL END), 0) as avgContentLength
     FROM interactions
     WHERE contactId = ?
       AND date >= date('now', '-90 days')`,
  );
  return statsStmt;
}

/** One contact's relationship score, a clamped integer 0 to 100. */
function computeScoreForContact(
  contact: ContactScoreRow,
  defaultCadence: number = 90,
): number {
  return computeBreakdown(contact, defaultCadence).score;
}

/** Compute the score *and* the reasoning behind it. */
function computeBreakdown(
  contact: ContactScoreRow,
  defaultCadence: number = 90,
): ScoreBreakdown {
  const cadence = contact.cadenceDays || defaultCadence;

  // Recency (40%)
  let recency = 0;
  if (contact.lastContactedAt) {
    const lastDate = new Date(contact.lastContactedAt);
    const daysSince = Math.max(
      0,
      (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    recency = recencyScore(daysSince, cadence);
  }
  // No lastContactedAt → 0 recency (never interacted)

  // Frequency, Depth, Reciprocity, Momentum (from interactions)
  const stats = statsStatement().get(contact.id) as InteractionStatsRow;

  // Frequency (25%): 10+ interactions in 90 days = max score
  const frequency = Math.min(100, stats.total90d * 10);

  // Depth (15%): Average content length of recent interactions, normalized
  // 500+ chars avg = max score
  const depth = Math.min(100, stats.avgContentLength / 5);

  // Reciprocity (10%): Ratio of bidirectional interaction types
  let reciprocity = 50; // Default: neutral
  if (stats.totalTypeCount > 0) {
    reciprocity = (stats.bidirectionalCount / stats.totalTypeCount) * 100;
  }

  // Momentum (10%): Trend comparison (30d vs prev 30d)
  let momentum = 50; // Default: stable
  if (stats.totalPrev30d > 0) {
    const ratio = stats.total30d / stats.totalPrev30d;
    if (ratio >= 1.2)
      momentum = 100; // Increasing
    else if (ratio <= 0.5)
      momentum = 0; // Declining sharply
    else momentum = ratio * 50 + 20; // Linear interpolation
  } else if (stats.total30d > 0) {
    momentum = 100; // New activity from nothing = max momentum
  } else {
    momentum = 0; // No activity at all
  }

  // Weighted composite
  const raw =
    WEIGHTS.recency * recency +
    WEIGHTS.frequency * frequency +
    WEIGHTS.depth * depth +
    WEIGHTS.reciprocity * reciprocity +
    WEIGHTS.momentum * momentum;

  const daysSince = contact.lastContactedAt
    ? Math.floor(
        (Date.now() - new Date(contact.lastContactedAt).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  const plural = (n: number, one: string, many = one + "s") =>
    `${n} ${n === 1 ? one : many}`;

  return {
    score: Math.round(Math.max(0, Math.min(100, raw))),
    components: [
      {
        key: "recency",
        label: "Recency",
        value: Math.round(recency),
        weight: WEIGHTS.recency,
        detail:
          daysSince === null
            ? "No interaction logged yet"
            : `Last contact ${daysSince === 0 ? "today" : plural(daysSince, "day") + " ago"}, against a ${cadence}-day cadence`,
      },
      {
        key: "frequency",
        label: "Frequency",
        value: Math.round(frequency),
        weight: WEIGHTS.frequency,
        detail: `${plural(stats.total90d, "interaction")} in the last 90 days`,
      },
      {
        key: "depth",
        label: "Depth",
        value: Math.round(depth),
        weight: WEIGHTS.depth,
        detail:
          stats.avgContentLength > 0
            ? `Notes average ${Math.round(stats.avgContentLength)} characters`
            : "No notes recorded on recent interactions",
      },
      {
        key: "reciprocity",
        label: "Reciprocity",
        value: Math.round(reciprocity),
        weight: WEIGHTS.reciprocity,
        detail:
          stats.totalTypeCount > 0
            ? `${stats.bidirectionalCount} of ${stats.totalTypeCount} were two-way (meeting, call, email)`
            : "Nothing recent to judge from",
      },
      {
        key: "momentum",
        label: "Momentum",
        value: Math.round(momentum),
        weight: WEIGHTS.momentum,
        detail: `${plural(stats.total30d, "interaction")} in the last 30 days vs ${stats.totalPrev30d} in the 30 before`,
      },
    ],
  };
}

// The sweeps

/** What one sweep did. */
export interface SweepResult {
  /** Accounts that had at least one contact to look at. */
  owners: number;
  /** Contacts whose score was recomputed and written. */
  scored: number;
  /**
   * Contacts marked for scoring that cannot have a score: a ghost, or archived.
   * Their flag is cleared, so one archived contact does not pull its owner into
   * every hourly pass.
   */
  cleared: number;
  /** Contacts whose scoring threw. Logged one by one, never retried. */
  skipped: number;
  elapsedMs: number;
}

/**
 * Contacts per transaction. better-sqlite3 is synchronous, so one transaction
 * over a whole account would hold every pending request. Each batch commits on
 * its own, about 2 ms per 100 contacts, and the loop yields between rounds.
 */
const BATCH_SIZE = 200;

/**
 * The most ids one request scores inline. Past this the rows stay marked and
 * the hourly sweep finishes the job.
 */
export const INLINE_SCORE_LIMIT = 10_000;

/**
 * A contact is scored when a person tracks it, and it is neither a ghost nor
 * archived. An untracked contact's stored score is a placeholder that no
 * reader shows (see `scoreView` in shared/scoreBand).
 */
const ELIGIBLE =
  "isTracked = 1 AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)";

/** One account's remaining work in the current sweep. */
interface OwnerQueue {
  ownerId: string;
  rows: ContactScoreRow[];
  next: number;
}

function ownersWithWork(full: boolean): string[] {
  const rows = full
    ? (sqlite
        .prepare(
          // tenant-lint: allow instance sweep
          `SELECT DISTINCT ownerId FROM contacts WHERE ${ELIGIBLE}`,
        )
        .all() as { ownerId: string | null }[])
    : (sqlite
        .prepare(
          // tenant-lint: allow instance sweep
          `SELECT DISTINCT ownerId FROM contacts WHERE scoreDirty = 1`,
        )
        .all() as { ownerId: string | null }[]);
  return rows
    .map((r) => r.ownerId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function candidatesFor(ownerId: string, full: boolean): ContactScoreRow[] {
  const sql = full
    ? `SELECT id, cadenceDays, lastContactedAt FROM contacts
        WHERE ownerId = ? AND ${ELIGIBLE}`
    : `SELECT id, cadenceDays, lastContactedAt FROM contacts
        WHERE ownerId = ? AND scoreDirty = 1 AND ${ELIGIBLE}`;
  return sqlite.prepare(sql).all(ownerId) as ContactScoreRow[];
}

/**
 * Clear the flag on rows that are marked but cannot be scored. Archiving is an
 * edit, so the trigger marks the row, and the sweep refuses to score it;
 * without this its owner would join every hourly sweep to do nothing.
 */
function clearIneligible(ownerId: string): number {
  return sqlite
    .prepare(
      `UPDATE contacts SET scoreDirty = 0
        WHERE ownerId = ? AND scoreDirty = 1 AND NOT (${ELIGIBLE})`,
    )
    .run(ownerId).changes;
}

async function runSweep(options: { full: boolean }): Promise<SweepResult> {
  const { full } = options;
  const startMs = Date.now();
  const label = full ? "full" : "incremental";

  const queues: OwnerQueue[] = [];
  let cleared = 0;
  for (const ownerId of ownersWithWork(full)) {
    if (!full) cleared += clearIneligible(ownerId);
    const rows = candidatesFor(ownerId, full);
    if (rows.length > 0) queues.push({ ownerId, rows, next: 0 });
  }

  const updateStmt = sqlite.prepare(
    // tenant-lint: allow instance sweep
    "UPDATE contacts SET relationshipScore = ?, scoreDirty = 0 WHERE id = ?",
  );

  let scored = 0;
  let skipped = 0;
  const ownerCadence = new Map<string, number>();

  // Round-robin: one batch per account per round. An account with fifty
  // thousand contacts therefore cannot put an account with fifty behind it.
  while (queues.some((q) => q.next < q.rows.length)) {
    for (const queue of queues) {
      if (queue.next >= queue.rows.length) continue;
      const defaultCadence =
        ownerCadence.get(queue.ownerId) ??
        (() => {
          const pref = getPreferences(queue.ownerId).defaultCadenceDays ?? 90;
          ownerCadence.set(queue.ownerId, pref);
          return pref;
        })();
      const batch = queue.rows.slice(queue.next, queue.next + BATCH_SIZE);
      queue.next += batch.length;

      const txn = sqlite.transaction(() => {
        for (const contact of batch) {
          try {
            updateStmt.run(
              computeScoreForContact(contact, defaultCadence),
              contact.id,
            );
            scored++;
          } catch (err: unknown) {
            skipped++;
            log.warn(
              "RelationshipScore",
              `Skipped ${contact.id}: ${getErrorMessage(err)}`,
            );
          }
        }
      });
      txn();
    }
    // Yield so pending HTTP requests are served between rounds.
    if (queues.some((q) => q.next < q.rows.length)) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  if (full) {
    const weekStart = isoWeekStart(new Date());
    for (const queue of queues) {
      snapshotScores(queue.ownerId, weekStart);
    }
  }

  const elapsedMs = Date.now() - startMs;
  const result: SweepResult = {
    owners: queues.length,
    scored,
    cleared,
    skipped,
    elapsedMs,
  };

  // A sweep that found nothing is the normal hourly case on a quiet instance.
  // Saying so every hour in the log is noise, so it goes to debug.
  const message =
    `${label} sweep: ${scored} scored across ${queues.length} account(s) ` +
    `in ${elapsedMs}ms` +
    (cleared > 0 ? `, ${cleared} cleared` : "") +
    (skipped > 0 ? `, ${skipped} skipped` : "");
  if (scored > 0 || skipped > 0) log.info("RelationshipScore", message);
  else log.debug("RelationshipScore", message);

  return result;
}

export const relationshipService = {
  /**
   * The score for a contact with the five signals behind it, computed fresh so
   * the explanation always matches its number.
   */
  explainScore(contactId: string): ScoreBreakdown | null {
    const contact = sqlite
      .prepare(
        // tenant-lint: allow owner-checked by caller
        `SELECT id, ownerId, cadenceDays, lastContactedAt, isTracked
           FROM contacts WHERE id = ?`,
      )
      .get(contactId) as ContactScoreTarget | undefined;
    // An untracked contact has no score to explain, and nothing is written:
    // MCP reads a contact through here, and a read must not score.
    if (!contact || !contact.isTracked) return null;

    const defaultCadence = contact.ownerId
      ? (getPreferences(contact.ownerId).defaultCadenceDays ?? 90)
      : 90;
    const breakdown = computeBreakdown(contact, defaultCadence);

    // Write the fresh score back. The stored score is refreshed hourly and can
    // be an hour stale, and an explanation adding up to 42 beside a badge
    // reading 45 would undo the trust it exists to build. One indexed write
    // makes them agree.
    sqlite
      .prepare(
        // tenant-lint: allow owner-checked by caller
        "UPDATE contacts SET relationshipScore = ?, scoreDirty = 0 WHERE id = ?",
      )
      .run(breakdown.score, contactId);

    return breakdown;
  },

  /**
   * Compute and save one contact's score, right after an interaction is
   * created. Only a tracked contact is scored: an interaction logged on anybody
   * else changes `lastContactedAt` and nothing more.
   */
  computeScore(contactId: string): number | null {
    return relationshipService.explainScore(contactId)?.score ?? null;
  },

  /**
   * Score every eligible contact on the instance, one owner at a time: the
   * daily pass. Recency decays with the clock, not with a write, so the dirty
   * flag cannot see it.
   */
  async recomputeAll(): Promise<SweepResult> {
    return runSweep({ full: true });
  },

  /**
   * Score only the contacts something changed, one owner at a time: the hourly
   * pass, and the one at startup. On a quiet instance it reads an empty partial
   * index and returns in under a millisecond.
   */
  async recomputeStale(): Promise<SweepResult> {
    return runSweep({ full: false });
  },

  /**
   * Score one owner's named contacts now, in the sweep's batches, for the
   * routes that turn tracking on, so the ring shows on the next read. Ids that
   * are not the owner's, not tracked, ghosts or archived are left alone. Above
   * `INLINE_SCORE_LIMIT` ids the rows stay marked for the sweep, so one request
   * cannot hold the process for a whole address book.
   */
  async scoreContacts(ownerId: string, ids: string[]): Promise<number> {
    if (ids.length === 0 || ids.length > INLINE_SCORE_LIMIT) return 0;
    const defaultCadence = getPreferences(ownerId).defaultCadenceDays ?? 90;
    const updateStmt = sqlite.prepare(
      "UPDATE contacts SET relationshipScore = ?, scoreDirty = 0 WHERE id = ? AND ownerId = ?",
    );
    let scored = 0;
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      const slice = ids.slice(start, start + BATCH_SIZE);
      const rows = sqlite
        .prepare(
          `SELECT id, cadenceDays, lastContactedAt FROM contacts
            WHERE ownerId = ? AND ${ELIGIBLE}
              AND id IN (${slice.map(() => "?").join(", ")})`,
        )
        .all(ownerId, ...slice) as ContactScoreRow[];
      const txn = sqlite.transaction(() => {
        for (const contact of rows) {
          updateStmt.run(
            computeScoreForContact(contact, defaultCadence),
            contact.id,
            ownerId,
          );
          scored++;
        }
      });
      txn();
      if (start + BATCH_SIZE < ids.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return scored;
  },

  snapshotScores,
  ensureWeeklySnapshot,
};

/**
 * Record a weekly score snapshot of an owner's contacts. INSERT OR IGNORE keeps
 * one per contact per ISO week.
 */
export function snapshotScores(ownerId: string, weekStart: string): number {
  return sqlite
    .prepare(
      `INSERT OR IGNORE INTO score_snapshots (ownerId, contactId, weekStart, score)
       SELECT ownerId, id, ?, relationshipScore FROM contacts
        WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isTracked = 1
          AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)`,
    )
    .run(weekStart, ownerId).changes;
}

/**
 * Weekly score snapshots for every active owner, on boot after the startup
 * sweep.
 */
export function ensureWeeklySnapshot(now: Date = new Date()): void {
  const weekStart = isoWeekStart(now);
  const owners = ownersWithWork(true);
  for (const ownerId of owners) {
    snapshotScores(ownerId, weekStart);
  }
}
