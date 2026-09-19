import { FADING_MIN } from "../../shared/scoreBand.ts";
import { resolveCapability } from "../ai/capabilities.ts";
import { sqlite, tableExists } from "../db.ts";
import { log } from "../utils/logger.ts";
import { actionItemService } from "./actionItemService.ts";
import { generateDailyInsight, DailyInsight } from "../ai/aiService.ts";
import { aiCache, ownerKey } from "../utils/aiCache.ts";
import { startOfDay, isBefore, isSameDay, isAfter, addDays } from "date-fns";
import type { ActionItem } from "../../src/types.ts";
import type { Scope } from "../tenancy/scope.ts";
import { searchRevision } from "./searchService.ts";
import { RequestCoalescer } from "../utils/requestCoalescer.ts";
import { isoWeekStart } from "../../shared/dates.ts";
import {
  toLocalDay,
  computeStreak,
  type ActivityDay,
  type DashboardActivityResponse,
  type DashboardMomentumResponse,
  type MomentumCard,
  type SilentCard,
  type StreakInteraction,
} from "../../shared/pulse.ts";

export const insightCoalescer = new RequestCoalescer();

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
    //
    // "At risk" here and in step 4 is the band under FADING_MIN in
    // shared/scoreBand, the same cut the avatar ring draws. The number goes
    // into the SQL text and not in a bound parameter. It is a constant from
    // code and never input, the six owner parameters keep their places, and
    // the text is the same statement it was with the literal 40.
    const metrics = sqlite
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as totalActive,
        (SELECT ROUND(AVG(CAST(julianday('now') - julianday(lastContactedAt) AS REAL))) FROM contacts WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL) AND lastContactedAt IS NOT NULL) as avgDaysSinceInteraction,
        (SELECT COUNT(*) FROM contacts WHERE ownerId = ? AND relationshipScore < ${FADING_MIN} AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)) as atRiskCount,
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
        AND c.relationshipScore < ${FADING_MIN}
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
      SELECT trim(industry) as industry, COUNT(*) as count
      FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND (isArchived = 0 OR isArchived IS NULL) AND isGhost = 0 AND industry IS NOT NULL AND trim(industry) != ''
      GROUP BY trim(industry) COLLATE NOCASE
      ORDER BY count DESC
      LIMIT 8
    `,
      )
      .all(scope.ownerId) as { industry: string; count: number }[];

    // 7. Location Composition
    const locationComposition = sqlite
      .prepare(
        `
      SELECT trim(location) as location, COUNT(*) as count
      FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND (isArchived = 0 OR isArchived IS NULL) AND isGhost = 0 AND location IS NOT NULL AND trim(location) != ''
      GROUP BY trim(location) COLLATE NOCASE
      ORDER BY count DESC
      LIMIT 8
    `,
      )
      .all(scope.ownerId) as { location: string; count: number }[];

    // 8. Role Composition
    const roleComposition = sqlite
      .prepare(
        `
      SELECT trim(role) as role, COUNT(*) as count
      FROM contacts
      WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND (isArchived = 0 OR isArchived IS NULL) AND isGhost = 0 AND role IS NOT NULL AND trim(role) != ''
      GROUP BY trim(role) COLLATE NOCASE
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

    // 11. Hygiene counts
    const missingCompany = (
      sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM contacts
            WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
              AND (company IS NULL OR trim(company) = '')`,
        )
        .get(scope.ownerId) as { count: number }
    ).count;

    const missingLocation = (
      sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM contacts
            WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
              AND (location IS NULL OR trim(location) = '')`,
        )
        .get(scope.ownerId) as { count: number }
    ).count;

    const missingEmail = (
      sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM contacts c
            WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND c.isGhost = 0 AND (c.isArchived = 0 OR c.isArchived IS NULL)
              AND NOT EXISTS (
                SELECT 1 FROM contact_emails ce WHERE ce.contactId = c.id AND ce.email IS NOT NULL AND trim(ce.email) != ''
              )`,
        )
        .get(scope.ownerId) as { count: number }
    ).count;

    const stale = (
      sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM contacts
            WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL AND isGhost = 0 AND (isArchived = 0 OR isArchived IS NULL)
              AND updatedAt < date('now', '-6 months')`,
        )
        .get(scope.ownerId) as { count: number }
    ).count;

    const hygiene = {
      missingCompany,
      missingLocation,
      missingEmail,
      stale,
    };

    // 12. Meetings (from upcoming_events when that table exists)
    let meetings: {
      title: string;
      startsAt: string;
      endsAt: string;
      contactIds: string[];
    }[] = [];
    if (tableExists("upcoming_events")) {
      try {
        const rows = sqlite
          .prepare(
            `SELECT title, startsAt, endsAt, contactIds FROM upcoming_events
              WHERE ownerId = ? AND startsAt >= datetime('now') AND startsAt <= datetime('now', '+7 days')
              ORDER BY startsAt ASC`,
          )
          .all(scope.ownerId) as {
          title: string;
          startsAt: string;
          endsAt: string;
          contactIds: string;
        }[];
        meetings = rows.map((r) => {
          let ids: string[] = [];
          if (typeof r.contactIds === "string") {
            try {
              ids = JSON.parse(r.contactIds);
            } catch {
              ids = [];
            }
          } else if (Array.isArray(r.contactIds)) {
            ids = r.contactIds;
          }
          return { ...r, contactIds: ids };
        });
      } catch {
        meetings = [];
      }
    }

    // 13. Correspondents (from connector_links when that table exists)
    let correspondents = 0;
    if (tableExists("connector_links")) {
      try {
        const row = sqlite
          .prepare(
            `SELECT COUNT(*) as count FROM connector_links WHERE ownerId = ? AND kind = 'correspondent'`,
          )
          .get(scope.ownerId) as { count: number } | undefined;
        correspondents = row?.count ?? 0;
      } catch {
        correspondents = 0;
      }
    }

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
      hygiene,
      meetings,
      correspondents,
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
   *
   * 2f moved the prefix into `ownerKey`, so this key and the per-owner
   * invalidation that drops it are built by the same function and cannot
   * disagree.
   */
  async getInsight(scope: Scope, signal?: AbortSignal) {
    const revision = searchRevision(scope);
    const model = resolveCapability("quick");
    const dateBucket = new Date().toISOString().slice(0, 10);
    const cacheKey = ownerKey(
      scope,
      `${revision}:${dateBucket}:${model?.providerId}:${model?.model}`,
    );
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

    const coalesceKey = `${scope.ownerId}:insight:${revision}:${dateBucket}:${model?.providerId ?? "none"}:${model?.model ?? "none"}`;

    return insightCoalescer.coalesce(
      coalesceKey,
      async (sharedSignal) => {
        const freshCached = aiCache.get<DailyInsight>("dailyInsight", cacheKey);
        if (freshCached) return freshCached;

        sharedSignal.throwIfAborted();

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
        for (const r of industryRows)
          industryDistribution[r.industry] = r.count;

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

        const insight = await generateDailyInsight(stats, {
          signal: sharedSignal,
        });
        sharedSignal.throwIfAborted();

        if (searchRevision(scope) !== revision) return null;
        if (insight) {
          aiCache.set("dailyInsight", cacheKey, insight);
        }

        return insight;
      },
      signal,
    );
  },

  /**
   * Deterministic activity aggregates for one owner: 84 days, week totals,
   * streaks, and today/this-week counts.
   */
  getActivity(scope: Scope): DashboardActivityResponse {
    const startMs = Date.now();
    const now = new Date();
    // 84 days ending today (day 83 is today, day 0 is 83 days ago)
    const days: ActivityDay[] = [];
    const dayMap = new Map<
      string,
      { count: number; byType: Record<string, number> }
    >();

    for (let i = 83; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayStr = toLocalDay(d);
      const entry = { count: 0, byType: {} };
      days.push({ day: dayStr, ...entry });
      dayMap.set(dayStr, entry);
    }

    // Previous 84 days for prevWeekTotals (167 days ago to 84 days ago)
    const prevDayMap = new Map<string, number>();
    for (let i = 167; i >= 84; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayStr = toLocalDay(d);
      prevDayMap.set(dayStr, 0);
    }

    const oldestDay = toLocalDay(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 167),
    );

    // Index seek on idx_interactions_owner_date
    const rows = sqlite
      .prepare(
        `SELECT date, type, source FROM interactions
          WHERE ownerId = ? AND date >= ?
          ORDER BY date ASC`,
      )
      .all(scope.ownerId, oldestDay) as {
      date: string;
      type: string | null;
      source: string | null;
    }[];

    for (const row of rows) {
      const dayStr = toLocalDay(row.date);
      const currentEntry = dayMap.get(dayStr);
      if (currentEntry) {
        currentEntry.count++;
        const type = row.type || "note";
        currentEntry.byType[type] = (currentEntry.byType[type] || 0) + 1;
      }
      if (prevDayMap.has(dayStr)) {
        prevDayMap.set(dayStr, (prevDayMap.get(dayStr) || 0) + 1);
      }
    }

    for (const d of days) {
      const entry = dayMap.get(d.day);
      if (entry) {
        d.count = entry.count;
        d.byType = entry.byType;
      }
    }

    const weekTotals: number[] = [];
    for (let w = 0; w < 12; w++) {
      const slice = days.slice(w * 7, (w + 1) * 7);
      const sum = slice.reduce((acc, curr) => acc + curr.count, 0);
      weekTotals.push(sum);
    }

    const prevWeekTotals: number[] = [];
    const prevDaysList = Array.from(prevDayMap.keys());
    for (let w = 0; w < 12; w++) {
      const slice = prevDaysList.slice(w * 7, (w + 1) * 7);
      const sum = slice.reduce(
        (acc, day) => acc + (prevDayMap.get(day) || 0),
        0,
      );
      prevWeekTotals.push(sum);
    }

    // Streak: all interactions with type != 'import' and source IS NULL
    const streakRows = sqlite
      .prepare(
        `SELECT DISTINCT date(date, 'localtime') as date FROM interactions
          WHERE ownerId = ? AND (type != 'import' OR type IS NULL) AND source IS NULL
          ORDER BY date ASC`,
      )
      .all(scope.ownerId) as StreakInteraction[];
    const streak = computeStreak(streakRows, now);

    // Today's counts
    const todayStr = toLocalDay(now);
    const todayEntry = dayMap.get(todayStr);
    const loggedToday = todayEntry ? todayEntry.count : 0;

    const completedToday = (
      sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM action_items
            WHERE ownerId = ? AND completedAt IS NOT NULL
              AND (date(completedAt, 'localtime') = ? OR date(completedAt) = ?)`,
        )
        .get(scope.ownerId, todayStr, todayStr) as { count: number }
    ).count;

    const dueToday = (
      sqlite
        .prepare(
          `SELECT COUNT(*) as count FROM action_items
            WHERE ownerId = ? AND completedAt IS NULL
              AND (date(dueAt, 'localtime') = ? OR date(dueAt) = ?)`,
        )
        .get(scope.ownerId, todayStr, todayStr) as { count: number }
    ).count;

    // thisWeek: logged, byType (starts on ISO week Monday)
    const currentWeekStart = isoWeekStart(now);
    let thisWeekLogged = 0;
    const thisWeekByType: Record<string, number> = {};

    for (const d of days) {
      if (d.day >= currentWeekStart && d.day <= todayStr) {
        thisWeekLogged += d.count;
        for (const [t, cnt] of Object.entries(d.byType)) {
          thisWeekByType[t] = (thisWeekByType[t] || 0) + cnt;
        }
      }
    }

    const elapsed = Date.now() - startMs;
    log.info("Dashboard", `Assembled dashboard activity in ${elapsed}ms`);

    return {
      days,
      weekTotals,
      prevWeekTotals,
      streak,
      today: {
        logged: loggedToday,
        completed: completedToday,
        due: dueToday,
      },
      thisWeek: {
        logged: thisWeekLogged,
        byType: thisWeekByType,
      },
    };
  },

  /**
   * Score momentum for one owner: rising, cooling and silent contacts.
   */
  getMomentum(scope: Scope): DashboardMomentumResponse {
    const startMs = Date.now();
    const weekRows = sqlite
      .prepare(
        `SELECT DISTINCT weekStart FROM score_snapshots
          WHERE ownerId = ?
          ORDER BY weekStart DESC`,
      )
      .all(scope.ownerId) as { weekStart: string }[];

    const snapshotWeeks = weekRows.length;
    let rising: MomentumCard[] = [];
    let cooling: MomentumCard[] = [];

    if (snapshotWeeks >= 4) {
      const currentWeek = weekRows[0].weekStart;
      const fourWeeksAgoWeek = isoWeekStart(
        new Date(Date.now() - 4 * 7 * 86_400_000),
      );
      const baselineWeek =
        weekRows.find((w) => w.weekStart <= fourWeeksAgoWeek)?.weekStart ??
        weekRows[3].weekStart;

      const diffRows = sqlite
        .prepare(
          `SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor,
                  curr.score as currentScore,
                  (curr.score - base.score) as delta
             FROM score_snapshots curr
             JOIN score_snapshots base ON curr.contactId = base.contactId AND base.weekStart = ? AND base.ownerId = curr.ownerId
             JOIN contacts c ON c.id = curr.contactId AND c.ownerId = curr.ownerId
            WHERE curr.ownerId = ? AND curr.weekStart = ?
              AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND c.isGhost = 0
              AND (c.isArchived = 0 OR c.isArchived IS NULL)
              AND abs(curr.score - base.score) >= 3`,
        )
        .all(baselineWeek, scope.ownerId, currentWeek) as {
        id: string;
        name: string;
        company: string | null;
        avatarUrl: string | null;
        themeColor: string | null;
        currentScore: number;
        delta: number;
      }[];

      const toMomentumCard = (r: (typeof diffRows)[0]): MomentumCard => ({
        id: r.id,
        name: r.name,
        company: r.company,
        avatarUrl: r.avatarUrl,
        themeColor: r.themeColor,
        relationshipScore: r.currentScore,
        score: r.currentScore,
        delta: Math.round(r.delta * 10) / 10,
      });

      rising = diffRows
        .filter((r) => r.delta >= 3)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5)
        .map(toMomentumCard);

      cooling = diffRows
        .filter((r) => r.delta <= -3)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 5)
        .map(toMomentumCard);
    }

    const silentRows = sqlite
      .prepare(
        `SELECT c.id, c.name, c.company, c.avatarUrl, c.themeColor, c.relationshipScore,
                c.cadenceDays,
                CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) as daysSinceContact,
                (CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) - c.cadenceDays) as overshootDays
           FROM contacts c
          WHERE c.ownerId = ?
            AND c.deletedAt IS NULL AND c.canonicalId IS NULL AND c.isGhost = 0
            AND (c.isArchived = 0 OR c.isArchived IS NULL)
            AND c.cadenceDays IS NOT NULL AND c.cadenceDays > 0
            AND c.lastContactedAt IS NOT NULL
            AND c.relationshipScore >= ${FADING_MIN}
            AND (CAST(julianday('now') - julianday(c.lastContactedAt) AS INTEGER) - c.cadenceDays) > 0
          ORDER BY overshootDays DESC
          LIMIT 5`,
      )
      .all(scope.ownerId) as {
      id: string;
      name: string;
      company: string | null;
      avatarUrl: string | null;
      themeColor: string | null;
      relationshipScore: number;
      cadenceDays: number;
      daysSinceContact: number;
      overshootDays: number;
    }[];

    const silent: SilentCard[] = silentRows.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      avatarUrl: c.avatarUrl,
      themeColor: c.themeColor,
      relationshipScore: c.relationshipScore,
      cadenceDays: c.cadenceDays,
      daysSinceContact: c.daysSinceContact,
      overshootDays: c.overshootDays,
    }));

    const elapsed = Date.now() - startMs;
    log.info("Dashboard", `Assembled dashboard momentum in ${elapsed}ms`);

    return {
      snapshotWeeks,
      rising,
      cooling,
      silent,
    };
  },
};
