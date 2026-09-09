import { resolveCapability } from "../ai/capabilities.ts";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { actionItemService } from "./actionItemService.ts";
import { generateDailyInsight, DailyInsight } from "../ai/aiService.ts";
import { aiCache } from "../utils/aiCache.ts";
import { startOfDay, isBefore, isSameDay, isAfter, addDays } from "date-fns";
import type { ActionItem } from "../../src/types.ts";
import type { Scope } from "../tenancy/scope.ts";

// =============================================================================
// Local row shapes for the raw SQL queries below (narrow — only the columns
// each SELECT actually returns).
// =============================================================================

/** Slim contact card columns shared by several dashboard queries. */
interface ContactCardRow {
  id: string;
  name: string;
  company: string | null;
  avatarUrl: string | null;
  themeColor: string | null;
}

interface DashboardMetricsRow {
  totalActive: number;
  avgDaysSinceInteraction: number | null;
  atRiskCount: number;
  totalInteractions30d: number;
  newContacts30d: number;
}

export const dashboardService = {
  /**
   * Every number on the dashboard, for one owner.
   *
   * Nine statements, and each one carries the owner. The contact aggregates
   * lead with `ownerId` so `idx_contacts_owner_status` and its siblings answer
   * them. The two interaction aggregates put the predicate on
   * `interactions.ownerId` rather than reaching through the contact subselect,
   * which is what `idx_interactions_owner_date` is for.
   */
  getDashboardPayload(scope: Scope) {
    const startMs = Date.now();

    // 1. Action Items categorized
    const allPending = actionItemService.getAllPending(scope) as ActionItem[];
    const today = startOfDay(new Date());
    const weekFromNow = addDays(today, 7);

    const overdue: ActionItem[] = [];
    const dueToday: ActionItem[] = [];
    const upcoming: ActionItem[] = [];

    for (const item of allPending) {
      if (!item.dueAt) continue;
      const due = startOfDay(new Date(item.dueAt));
      if (isBefore(due, today)) {
        overdue.push(item);
      } else if (isSameDay(due, today)) {
        dueToday.push(item);
      } else if (isAfter(due, today) && !isAfter(due, weekFromNow)) {
        upcoming.push(item);
      }
    }

    // 2. Ghosts
    const ghosts = sqlite
      .prepare(
        `
      SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor,
             COUNT(DISTINCT im.interactionId) as mentionCount
      FROM contacts c
      JOIN interaction_mentions im ON c.id = im.contactId
      WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND c.isGhost = 1 AND (c.isArchived = 0 OR c.isArchived IS NULL)
      GROUP BY c.id
      ORDER BY mentionCount DESC
      LIMIT 5
    `,
      )
      .all(scope.ownerId) as (ContactCardRow & { mentionCount: number })[];

    // 3. Metrics
    const metrics = sqlite
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as totalActive,
        (SELECT ROUND(AVG(CAST(julianday('now') - julianday(lastContactedAt) AS REAL))) FROM contacts WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND lastContactedAt IS NOT NULL) as avgDaysSinceInteraction,
        (SELECT COUNT(*) FROM contacts WHERE ownerId = ? AND relationshipScore < 40 AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as atRiskCount,
        (SELECT COUNT(*) FROM interactions WHERE ownerId = ? AND date >= date('now', '-30 days') AND contactId IN (SELECT id FROM contacts WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND COALESCE(isArchived, 0) = 0)) as totalInteractions30d,
        (SELECT COUNT(*) FROM contacts WHERE ownerId = ? AND addedAt >= date('now', '-30 days') AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as newContacts30d
    `,
      )
      .get(
        scope.ownerId,
        scope.ownerId,
        scope.ownerId,
        scope.ownerId,
        scope.ownerId,
        scope.ownerId,
      ) as DashboardMetricsRow;

    if (metrics.avgDaysSinceInteraction === null) {
      metrics.avgDaysSinceInteraction = 0;
    }

    // 4. At Risk
    const atRisk = sqlite
      .prepare(
        `
      SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.relationshipScore,
             CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) as daysSinceContact,
             (SELECT title FROM interactions WHERE contactId = c.id AND ownerId = c.ownerId ORDER BY date DESC LIMIT 1) as lastInteractionTitle
      FROM contacts c
      WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND c.isGhost = 0
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
        AND c.relationshipScore < 40
        AND c.lastContactedAt IS NOT NULL
      ORDER BY c.relationshipScore ASC
      LIMIT 10
    `,
      )
      .all(scope.ownerId) as (ContactCardRow & {
      relationshipScore: number;
      daysSinceContact: number;
      lastInteractionTitle: string | null;
    })[];

    // 5. Recently Added
    const recentlyAdded = sqlite
      .prepare(
        `
      SELECT id, name, company, avatarUrl, themeColor, addedAt
      FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      ORDER BY addedAt DESC
      LIMIT 5
    `,
      )
      .all(scope.ownerId) as (ContactCardRow & { addedAt: string | null })[];

    // 6. Industry Composition
    const industryComposition = sqlite
      .prepare(
        `
      SELECT industry, COUNT(*) as count
      FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isArchived = 0 AND isGhost = 0 AND industry IS NOT NULL AND industry != ''
      GROUP BY industry
      ORDER BY count DESC
      LIMIT 8
    `,
      )
      .all(scope.ownerId) as { industry: string; count: number }[];

    // 7. Location Composition
    const locationComposition = sqlite
      .prepare(
        `
      SELECT location, COUNT(*) as count
      FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isArchived = 0 AND isGhost = 0 AND location IS NOT NULL AND location != ''
      GROUP BY location
      ORDER BY count DESC
      LIMIT 8
    `,
      )
      .all(scope.ownerId) as { location: string; count: number }[];

    // 8. Role Composition
    const roleComposition = sqlite
      .prepare(
        `
      SELECT role, COUNT(*) as count
      FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isArchived = 0 AND isGhost = 0 AND role IS NOT NULL AND role != ''
      GROUP BY role
      ORDER BY count DESC
      LIMIT 8
    `,
      )
      .all(scope.ownerId) as { role: string; count: number }[];

    // 9. Interaction Breakdown (30d)
    const interactionBreakdown30d = sqlite
      .prepare(
        `
      SELECT type, COUNT(*) as count
      FROM interactions
      WHERE ownerId = ? AND date >= date('now', '-30 days') AND contactId IN (SELECT id FROM contacts WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND COALESCE(isArchived, 0) = 0)
      GROUP BY type
      ORDER BY count DESC
    `,
      )
      .all(scope.ownerId, scope.ownerId) as { type: string; count: number }[];

    // 10. Network Growth Timeline (30d)
    const networkGrowthTimeline30d = sqlite
      .prepare(
        `
      SELECT id, name, company, avatarUrl, themeColor, addedAt
      FROM contacts
      WHERE ownerId = ? AND addedAt >= date('now', '-30 days') AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      ORDER BY addedAt DESC
      LIMIT 20
    `,
      )
      .all(scope.ownerId) as (ContactCardRow & { addedAt: string | null })[];

    const elapsed = Date.now() - startMs;
    log.info("Dashboard", `Assembled dashboard payload in ${elapsed}ms`);

    return {
      overdue,
      dueToday,
      upcoming,
      ghosts,
      metrics,
      atRisk,
      recentlyAdded,
      industryComposition,
      locationComposition,
      roleComposition,
      interactionBreakdown30d,
      networkGrowthTimeline30d,
    };
  },

  /**
   * One owner's daily insight about their own network.
   *
   * The cache key leads with the owner id. Before this the key described the
   * instance, so the first account to open the dashboard generated a paragraph
   * about their contacts and every other account was served that same
   * paragraph for the next 24 hours. The tier also held one entry, so a second
   * owner's insight evicted the first; `maxEntries` is 100 now, which is one
   * slot per owner on an instance of that size.
   */
  async getInsight(scope: Scope) {
    const revision = (
      sqlite
        .prepare("SELECT revision FROM search_revision WHERE id = 1")
        .get() as { revision: number }
    ).revision;
    const model = resolveCapability("quick");
    const cacheKey = `${scope.ownerId}::${revision}:${new Date().toISOString().slice(0, 10)}:${model?.providerId}:${model?.model}`;
    // Check unified cache (24h TTL managed by aiCache)
    const cached = aiCache.get<DailyInsight>("dailyInsight", cacheKey);
    if (cached) {
      import("./aiStatsService.ts").then(({ recordInvocation }) => {
        recordInvocation({
          operation: "dailyInsight",
          latencyMs: 0,
          cached: true,
          description: "Daily Insight cache hit",
        });
      });
      return cached;
    }

    log.info(
      "Dashboard",
      "Cache miss for Daily Insight. Generating new insight...",
    );

    const totalActive = (
      sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM contacts WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)`,
        )
        .get(scope.ownerId) as { count: number }
    ).count;

    const industryRows = sqlite
      .prepare(
        `
      SELECT industry, COUNT(*) as count
      FROM contacts
      WHERE ownerId = ? AND industry IS NOT NULL AND industry != '' AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      GROUP BY industry
    `,
      )
      .all(scope.ownerId) as { industry: string; count: number }[];
    const industryDistribution: Record<string, number> = {};
    for (const r of industryRows) industryDistribution[r.industry] = r.count;

    const notReached = sqlite
      .prepare(
        `
      SELECT name FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
        AND lastContactedAt < date('now', '-60 days')
      LIMIT 10
    `,
      )
      .all(scope.ownerId) as { name: string }[];

    const newContacts30d = (
      sqlite
        .prepare(
          `
      SELECT COUNT(*) as count FROM contacts
      WHERE ownerId = ? AND addedAt >= date('now', '-30 days') AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
    `,
        )
        .get(scope.ownerId) as { count: number }
    ).count;

    const topRel = sqlite
      .prepare(
        `
      SELECT name FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      ORDER BY relationshipScore DESC
      LIMIT 3
    `,
      )
      .all(scope.ownerId) as { name: string }[];

    const bottomRel = sqlite
      .prepare(
        `
      SELECT name FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND lastContactedAt IS NOT NULL
      ORDER BY relationshipScore ASC
      LIMIT 3
    `,
      )
      .all(scope.ownerId) as { name: string }[];

    const numContacts = totalActive;

    // Check if we have enough data so the AI doesn't hallucinate weird stuff
    if (numContacts === 0) return null;

    const stats = {
      totalContacts: numContacts,
      industryDistribution,
      atRiskNames: notReached.map((r) => r.name),
      newContactsCount: newContacts30d,
      topRelationships: topRel.map((r) => r.name),
      bottomRelationships: bottomRel.map((r) => r.name),
    };

    const insight = await generateDailyInsight(stats);
    if (
      (
        sqlite
          .prepare("SELECT revision FROM search_revision WHERE id = 1")
          .get() as { revision: number }
      ).revision !== revision
    )
      return null;
    if (insight) {
      aiCache.set("dailyInsight", cacheKey, insight);
    }

    return insight;
  },
};
