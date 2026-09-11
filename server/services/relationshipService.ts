/**
 * Relationship Scoring Service — Computes health scores for contacts.
 *
 * Score formula (0–100):
 *   Score = 0.40·Recency + 0.25·Frequency + 0.15·Depth + 0.10·Reciprocity + 0.10·Momentum
 *
 * Each signal is computed from existing database tables — no new tables needed.
 * Scores are stored on `contacts.relationshipScore` for fast reads.
 *
 * Recomputation triggers:
 *   - On interaction creation (single contact, immediate)
 *   - On server startup (only what changed while the server was down)
 *   - Every 60 minutes (only what changed, per owner)
 *   - Every 24 hours (every contact, because recency decays with the clock)
 *
 * ── Why there are two sweeps ────────────────────────────────────────────────
 * Four of the five signals only move when something is written: a new
 * interaction, an edited cadence, a contact that was archived. Recency moves
 * on its own, every day, for every contact — so a dirty-only sweep alone would
 * freeze the score of anyone nobody has touched, which is exactly the person
 * the score exists to surface.
 *
 * So the hourly pass reads `contacts.scoreDirty`, a flag the database sets
 * through triggers on `contacts`, `interactions` and `action_items` (see §4 and
 * §6 of server/db.ts), and the daily pass reads everything. On a quiet instance
 * the hourly pass scans a partial index that holds no rows.
 *
 * ── Why per owner ──────────────────────────────────────────────────────────
 * Both sweeps walk one owner at a time and take turns: a batch for each owner
 * in round-robin, then a yield to the event loop. An account with fifty
 * thousand contacts therefore cannot put an account with fifty behind it, and
 * neither can hold a request waiting. It also keeps each transaction inside one
 * account, which is what the rest of the server assumes.
 *
 * @module server/services/relationshipService
 */
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

// =============================================================================
// Types
// =============================================================================

interface ContactScoreRow {
  id: string;
  cadenceDays: number | null;
  lastContactedAt: string | null;
}

interface InteractionStatsRow {
  total90d: number;
  total30d: number;
  totalPrev30d: number;
  bidirectionalCount: number;
  totalTypeCount: number;
  avgContentLength: number;
}

// =============================================================================
// Scoring Algorithm
// =============================================================================

/**
 * Sigmoid decay function for recency scoring.
 * Stays near 100 within cadence, drops steeply after.
 * k=0.08 gives a gentler curve that doesn't punish 1-2 day delays too hard.
 */
function recencyScore(daysSinceContact: number, cadenceDays: number): number {
  if (daysSinceContact <= 0) return 100;
  const k = 0.08;
  return 100 / (1 + Math.exp(k * (daysSinceContact - cadenceDays)));
}

/**
 * The five signals behind a score, each 0–100, with the weight applied to it.
 *
 * Returned rather than discarded because a bare number out of 100 attached to
 * a person is a judgement nobody can check. "42" means nothing; "you last
 * spoke 8 months ago, against a 90-day cadence" is something you can act on or
 * disagree with.
 */
export interface ScoreBreakdown {
  score: number;
  components: {
    key: "recency" | "frequency" | "depth" | "reciprocity" | "momentum";
    label: string;
    /** 0–100 for this signal alone. */
    value: number;
    /** Its share of the composite, 0–1. */
    weight: number;
    /** What this signal measured, in words. */
    detail: string;
  }[];
}

const WEIGHTS = {
  recency: 0.4,
  frequency: 0.25,
  depth: 0.15,
  reciprocity: 0.1,
  momentum: 0.1,
} as const;

/**
 * The per-contact interaction rollup, prepared once.
 *
 * It used to be prepared inside the loop, so a sweep of 10,000 contacts
 * compiled the same statement 10,000 times. Lazy rather than at module load
 * because the unit project replaces `server/db.ts` with a stub.
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

/** Tests only: drop the cached statement when the database is replaced. */
export function __resetScoringStatements(): void {
  statsStmt = null;
}

/**
 * Compute a single contact's relationship score.
 * Returns a clamped integer 0-100.
 */
function computeScoreForContact(contact: ContactScoreRow): number {
  return computeBreakdown(contact).score;
}

/** Compute the score *and* the reasoning behind it. */
function computeBreakdown(contact: ContactScoreRow): ScoreBreakdown {
  const cadence = contact.cadenceDays || 90;

  // ── Recency (40%) ──────────────────────────────────────────────────────
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

  // ── Frequency, Depth, Reciprocity, Momentum (from interactions) ────────
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

  // ── Weighted composite ─────────────────────────────────────────────────
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

// =============================================================================
// Public API
// =============================================================================

// =============================================================================
// The sweeps
// =============================================================================

/** What one sweep did. */
export interface SweepResult {
  /** Accounts that had at least one contact to look at. */
  owners: number;
  /** Contacts whose score was recomputed and written. */
  scored: number;
  /**
   * Contacts that were marked for scoring but are not eligible for a score:
   * a ghost, or archived. Their flag is cleared so the next sweep does not
   * find them again, which is what stops one archived contact making its
   * owner part of every hourly pass for ever.
   */
  cleared: number;
  /** Contacts whose scoring threw. Logged one by one, never retried. */
  skipped: number;
  elapsedMs: number;
}

/**
 * Contacts per transaction.
 *
 * better-sqlite3 is synchronous, so one transaction over a whole account would
 * hold every pending HTTP request for its duration. Each batch commits on its
 * own — about 2 ms per 100 contacts — and the loop yields between rounds.
 */
const BATCH_SIZE = 200;

/** A contact is scored when it is neither a ghost nor archived. */
const ELIGIBLE = "isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)";

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
 * Clear the flag on rows that are marked but cannot be scored.
 *
 * Archiving a contact is an edit, so the trigger marks it, and the sweep then
 * refuses to score it. Without this the row stays marked and its owner joins
 * every hourly sweep from then on to do nothing at all.
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

  // Round-robin: one batch per account per round. An account with fifty
  // thousand contacts therefore cannot put an account with fifty behind it.
  while (queues.some((q) => q.next < q.rows.length)) {
    for (const queue of queues) {
      if (queue.next >= queue.rows.length) continue;
      const batch = queue.rows.slice(queue.next, queue.next + BATCH_SIZE);
      queue.next += batch.length;

      const txn = sqlite.transaction(() => {
        for (const contact of batch) {
          try {
            updateStmt.run(computeScoreForContact(contact), contact.id);
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
   * The score for a contact, together with the five signals that produced it.
   * Computed fresh rather than read from the stored scalar, so the explanation
   * always matches the number it is explaining.
   */
  explainScore(contactId: string): ScoreBreakdown | null {
    const contact = sqlite
      .prepare(
        // tenant-lint: allow owner-checked by caller
        `SELECT id, cadenceDays, lastContactedAt FROM contacts WHERE id = ?`,
      )
      .get(contactId) as ContactScoreRow | undefined;
    if (!contact) return null;

    const breakdown = computeBreakdown(contact);

    // Write the fresh score back. `contacts.relationshipScore` is a cache
    // refreshed hourly, so by the time someone asks *why* a score is what it
    // is, the stored number can be an hour stale — and an explanation that
    // adds up to 42 sitting next to a badge reading 45 undermines the very
    // trust the explanation exists to build. Recomputing already happened
    // above; persisting it costs one indexed write and makes the two agree.
    sqlite
      .prepare(
        // tenant-lint: allow owner-checked by caller
        "UPDATE contacts SET relationshipScore = ?, scoreDirty = 0 WHERE id = ?",
      )
      .run(breakdown.score, contactId);

    return breakdown;
  },

  /**
   * Compute and persist the relationship score for a single contact.
   * Called after each interaction creation for immediate feedback.
   */
  computeScore(contactId: string): number {
    const contact = sqlite
      .prepare(
        // tenant-lint: allow owner-checked by caller
        `
      SELECT id, cadenceDays, lastContactedAt FROM contacts WHERE id = ?
    `,
      )
      .get(contactId) as ContactScoreRow | undefined;

    if (!contact) return 50;

    const score = computeScoreForContact(contact);
    sqlite
      .prepare(
        // tenant-lint: allow owner-checked by caller
        "UPDATE contacts SET relationshipScore = ?, scoreDirty = 0 WHERE id = ?",
      )
      .run(score, contactId);
    return score;
  },

  /**
   * Score every eligible contact on the instance, one owner at a time.
   *
   * The daily pass. Recency decays with the clock rather than with a write, so
   * a contact nobody has touched still changes score overnight, and the dirty
   * flag can never see that.
   */
  async recomputeAll(): Promise<SweepResult> {
    return runSweep({ full: true });
  },

  /**
   * Score only the contacts something changed, one owner at a time.
   *
   * The hourly pass, and the one that runs at startup. On a quiet instance it
   * reads an empty partial index and returns in under a millisecond.
   */
  async recomputeStale(): Promise<SweepResult> {
    return runSweep({ full: false });
  },
};
