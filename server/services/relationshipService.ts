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
 * Compute a single contact's relationship score.
 * Returns a clamped integer 0-100.
 */
function computeScoreForContact(contact: ContactScoreRow): number {
  const cadence = contact.cadenceDays || 90;

  // ── Recency (40%) ──────────────────────────────────────────────────────
  let recency = 0;
  if (contact.lastContactedAt) {
    const lastDate = new Date(contact.lastContactedAt);
    const daysSince = Math.max(0, (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    recency = recencyScore(daysSince, cadence);
  }
  // No lastContactedAt → 0 recency (never interacted)

  // ── Frequency, Depth, Reciprocity, Momentum (from interactions) ────────
  const stats = sqlite.prepare(`
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
  `).get(contact.id) as InteractionStatsRow;

  // Frequency (25%): 10+ interactions in 90 days = max score
  const frequency = Math.min(100, stats.total90d * 10);

  // Depth (15%): Average content length of recent interactions, normalized
  // 500+ chars avg = max score
  const depth = Math.min(100, (stats.avgContentLength / 5));

  // Reciprocity (10%): Ratio of bidirectional interaction types
  let reciprocity = 50; // Default: neutral
  if (stats.totalTypeCount > 0) {
    reciprocity = (stats.bidirectionalCount / stats.totalTypeCount) * 100;
  }

  // Momentum (10%): Trend comparison (30d vs prev 30d)
  let momentum = 50; // Default: stable
  if (stats.totalPrev30d > 0) {
    const ratio = stats.total30d / stats.totalPrev30d;
    if (ratio >= 1.2) momentum = 100;      // Increasing
    else if (ratio <= 0.5) momentum = 0;   // Declining sharply
    else momentum = ratio * 50 + 20;       // Linear interpolation
  } else if (stats.total30d > 0) {
    momentum = 100; // New activity from nothing = max momentum
  } else {
    momentum = 0; // No activity at all
  }

  // ── Weighted composite ─────────────────────────────────────────────────
  const raw = (0.40 * recency) + (0.25 * frequency) + (0.15 * depth) + (0.10 * reciprocity) + (0.10 * momentum);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

// =============================================================================
// Public API
// =============================================================================

export const relationshipService = {
  /**
   * Compute and persist the relationship score for a single contact.
   * Called after each interaction creation for immediate feedback.
   */
  computeScore(contactId: string): number {
    const contact = sqlite.prepare(`
      SELECT id, cadenceDays, lastContactedAt FROM contacts WHERE id = ?
    `).get(contactId) as ContactScoreRow | undefined;

    if (!contact) return 50;

    const score = computeScoreForContact(contact);
    sqlite.prepare("UPDATE contacts SET relationshipScore = ? WHERE id = ?").run(score, contactId);
    return score;
  },

  /**
   * Batch recompute all non-archived, non-ghost contact scores.
   * Called on server startup and every 60 minutes via setInterval.
   * Uses a single transaction for efficiency — measured at ~2ms per 100 contacts.
   */
  recomputeAll(): void {
    const startMs = Date.now();

    const contacts = sqlite.prepare(`
      SELECT id, cadenceDays, lastContactedAt FROM contacts
      WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
    `).all() as ContactScoreRow[];

    const updateStmt = sqlite.prepare("UPDATE contacts SET relationshipScore = ? WHERE id = ?");

    let skipped = 0;
    const txn = sqlite.transaction(() => {
      for (const c of contacts) {
        try {
          const score = computeScoreForContact(c);
          updateStmt.run(score, c.id);
        } catch (err: any) {
          skipped++;
          log.warn("RelationshipScore", `Skipped ${c.id}: ${err.message}`);
        }
      }
    });
    txn();

    const elapsed = Date.now() - startMs;
    log.info("RelationshipScore", `Recomputed ${contacts.length} scores in ${elapsed}ms${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
  },
};
