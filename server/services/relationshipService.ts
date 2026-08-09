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
 *   - On server startup (full sweep)
 *   - Every 60 minutes (full sweep, catches recency decay)
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
  const stats = sqlite
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN date >= date('now', '-90 days') THEN 1 ELSE 0 END), 0) as total90d,
      COALESCE(SUM(CASE WHEN date >= date('now', '-30 days') THEN 1 ELSE 0 END), 0) as total30d,
      COALESCE(SUM(CASE WHEN date >= date('now', '-60 days') AND date < date('now', '-30 days') THEN 1 ELSE 0 END), 0) as totalPrev30d,
      COALESCE(SUM(CASE WHEN type IN ('meeting', 'call', 'email') THEN 1 ELSE 0 END), 0) as bidirectionalCount,
      COUNT(*) as totalTypeCount,
      COALESCE(AVG(CASE WHEN content IS NOT NULL AND content != '' THEN LENGTH(content) ELSE NULL END), 0) as avgContentLength
    FROM interactions
    WHERE contactId = ?
      AND date >= date('now', '-90 days')
  `,
    )
    .get(contact.id) as InteractionStatsRow;

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

export const relationshipService = {
  /**
   * The score for a contact, together with the five signals that produced it.
   * Computed fresh rather than read from the stored scalar, so the explanation
   * always matches the number it is explaining.
   */
  explainScore(contactId: string): ScoreBreakdown | null {
    const contact = sqlite
      .prepare(
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
      .prepare("UPDATE contacts SET relationshipScore = ? WHERE id = ?")
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
        `
      SELECT id, cadenceDays, lastContactedAt FROM contacts WHERE id = ?
    `,
      )
      .get(contactId) as ContactScoreRow | undefined;

    if (!contact) return 50;

    const score = computeScoreForContact(contact);
    sqlite
      .prepare("UPDATE contacts SET relationshipScore = ? WHERE id = ?")
      .run(score, contactId);
    return score;
  },

  /**
   * Batch recompute all non-archived, non-ghost contact scores.
   * Called on server startup and every 60 minutes via setInterval.
   *
   * Runs in batches of 200 with an event-loop yield between batches:
   * better-sqlite3 is synchronous, so a single monolithic transaction over
   * thousands of contacts would starve every pending HTTP request for the
   * full duration. Each batch commits its own transaction (~2ms per 100
   * contacts), so requests interleave between batches.
   */
  async recomputeAll(): Promise<void> {
    const startMs = Date.now();

    const contacts = sqlite
      .prepare(
        `
      SELECT id, cadenceDays, lastContactedAt FROM contacts
      WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
    `,
      )
      .all() as ContactScoreRow[];

    const updateStmt = sqlite.prepare(
      "UPDATE contacts SET relationshipScore = ? WHERE id = ?",
    );

    const BATCH_SIZE = 200;
    let skipped = 0;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const txn = sqlite.transaction(() => {
        for (const c of batch) {
          try {
            const score = computeScoreForContact(c);
            updateStmt.run(score, c.id);
          } catch (err: unknown) {
            skipped++;
            log.warn(
              "RelationshipScore",
              `Skipped ${c.id}: ${getErrorMessage(err)}`,
            );
          }
        }
      });
      txn();

      // Yield so pending HTTP requests are served between batches.
      if (i + BATCH_SIZE < contacts.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    const elapsed = Date.now() - startMs;
    log.info(
      "RelationshipScore",
      `Recomputed ${contacts.length} scores in ${elapsed}ms${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
    );
  },
};
