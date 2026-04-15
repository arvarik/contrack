import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { actionItemService } from "./actionItemService.ts";
import { generateDailyInsight, DailyInsight } from "../ai/aiService.ts";
import { aiCache } from "../utils/aiCache.ts";
import { startOfDay, isBefore, isSameDay, isAfter, addDays } from "date-fns";
import type { ActionItem } from "../../src/types.ts";

/**
 * Discard the cached Daily Insight. Call this any time contact data is mutated
 * so the next dashboard/insight request regenerates with fresh CRM data.
 */
export function invalidateDailyInsight(): void {
  aiCache.invalidate("dailyInsight");
}

export const dashboardService = {
  getDashboardPayload() {
    const startMs = Date.now();

    // 1. Action Items categorized
    const allPending = actionItemService.getAllPending() as ActionItem[];
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
    const ghosts = sqlite.prepare(`
      SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor,
             COUNT(DISTINCT im.interactionId) as mentionCount
      FROM contacts c
      JOIN interaction_mentions im ON c.id = im.contactId
      WHERE c.isGhost = 1 AND (c.isArchived = 0 OR c.isArchived IS NULL)
      GROUP BY c.id
      ORDER BY mentionCount DESC
      LIMIT 5
    `).all() as any[];

    // 3. Metrics
    const metrics = sqlite.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM contacts WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as totalActive,
        (SELECT ROUND(AVG(CAST(julianday('now') - julianday(lastContactedAt) AS REAL))) FROM contacts WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND lastContactedAt IS NOT NULL) as avgDaysSinceInteraction,
        (SELECT COUNT(*) FROM contacts WHERE relationshipScore < 40 AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as atRiskCount,
        (SELECT COUNT(*) FROM interactions WHERE date >= date('now', '-30 days')) as totalInteractions30d,
        (SELECT COUNT(*) FROM contacts WHERE addedAt >= date('now', '-30 days') AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as newContacts30d
    `).get() as any;

    if (metrics.avgDaysSinceInteraction === null) {
      metrics.avgDaysSinceInteraction = 0;
    }

    // 4. At Risk
    const atRisk = sqlite.prepare(`
      SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.relationshipScore,
             CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) as daysSinceContact,
             (SELECT title FROM interactions WHERE contactId = c.id ORDER BY date DESC LIMIT 1) as lastInteractionTitle
      FROM contacts c
      WHERE c.isGhost = 0
        AND (c.isArchived = 0 OR c.isArchived IS NULL)
        AND c.relationshipScore < 40
        AND c.lastContactedAt IS NOT NULL
      ORDER BY c.relationshipScore ASC
      LIMIT 10
    `).all() as any[];

    // 5. Recently Added
    const recentlyAdded = sqlite.prepare(`
      SELECT id, name, company, avatarUrl, themeColor, addedAt
      FROM contacts
      WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      ORDER BY addedAt DESC
      LIMIT 5
    `).all() as any[];

    // 6. Industry Composition
    const industryComposition = sqlite.prepare(`
      SELECT industry, COUNT(*) as count 
      FROM contacts 
      WHERE isArchived = 0 AND isGhost = 0 AND industry IS NOT NULL AND industry != ''
      GROUP BY industry 
      ORDER BY count DESC 
      LIMIT 8
    `).all() as { industry: string, count: number }[];

    // 7. Location Composition
    const locationComposition = sqlite.prepare(`
      SELECT location, COUNT(*) as count 
      FROM contacts 
      WHERE isArchived = 0 AND isGhost = 0 AND location IS NOT NULL AND location != ''
      GROUP BY location 
      ORDER BY count DESC 
      LIMIT 8
    `).all() as { location: string, count: number }[];

    // 8. Role Composition
    const roleComposition = sqlite.prepare(`
      SELECT role, COUNT(*) as count 
      FROM contacts 
      WHERE isArchived = 0 AND isGhost = 0 AND role IS NOT NULL AND role != ''
      GROUP BY role 
      ORDER BY count DESC 
      LIMIT 8
    `).all() as { role: string, count: number }[];

    // 9. Interaction Breakdown (30d)
    const interactionBreakdown30d = sqlite.prepare(`
      SELECT type, COUNT(*) as count
      FROM interactions
      WHERE date >= date('now', '-30 days')
      GROUP BY type
      ORDER BY count DESC
    `).all() as { type: string, count: number }[];

    // 10. Network Growth Timeline (30d)
    const networkGrowthTimeline30d = sqlite.prepare(`
      SELECT id, name, company, avatarUrl, themeColor, addedAt
      FROM contacts
      WHERE addedAt >= date('now', '-30 days') AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      ORDER BY addedAt DESC
      LIMIT 20
    `).all() as any[];

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
      networkGrowthTimeline30d
    };
  },

  async getInsight() {
    // Check unified cache (24h TTL managed by aiCache)
    const cached = aiCache.get<DailyInsight>("dailyInsight", "singleton");
    if (cached) {
      import("./aiStatsService.ts").then(({ recordInvocation }) => {
        recordInvocation({ operation: "dailyInsight", latencyMs: 0, cached: true, description: "Daily Insight cache hit" });
      });
      return cached;
    }

    log.info("Dashboard", "Cache miss for Daily Insight. Generating new insight...");

    const totalActive = (sqlite.prepare(`SELECT COUNT(*) as count FROM contacts WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)`).get() as any).count;
    
    const industryRows = sqlite.prepare(`
      SELECT industry, COUNT(*) as count 
      FROM contacts 
      WHERE industry IS NOT NULL AND industry != '' AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      GROUP BY industry
    `).all() as { industry: string, count: number }[];
    const industryDistribution: Record<string, number> = {};
    for (const r of industryRows) industryDistribution[r.industry] = r.count;

    const notReached = sqlite.prepare(`
      SELECT name FROM contacts 
      WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) 
        AND lastContactedAt < date('now', '-60 days')
      LIMIT 10
    `).all() as { name: string }[];

    const newContacts30d = (sqlite.prepare(`
      SELECT COUNT(*) as count FROM contacts 
      WHERE addedAt >= date('now', '-30 days') AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
    `).get() as any).count;

    const topRel = sqlite.prepare(`
      SELECT name FROM contacts 
      WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
      ORDER BY relationshipScore DESC
      LIMIT 3
    `).all() as { name: string }[];

    const bottomRel = sqlite.prepare(`
      SELECT name FROM contacts 
      WHERE isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND lastContactedAt IS NOT NULL
      ORDER BY relationshipScore ASC
      LIMIT 3
    `).all() as { name: string }[];

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
    if (insight) {
      aiCache.set("dailyInsight", "singleton", insight);
    }
    
    return insight;
  }
};
