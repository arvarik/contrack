/**
 * Shared Pulse Types and Utilities.
 *
 * Days and streaks are computed in the server's local time.
 */

export interface ActivityDay {
  day: string; // YYYY-MM-DD
  count: number;
  byType: Record<string, number>;
}

export interface DashboardActivityResponse {
  days: ActivityDay[]; // 84 days, oldest first
  weekTotals: number[]; // 12 numbers
  prevWeekTotals: number[]; // 12 numbers
  streak: {
    current: number;
    best: number;
    lastDay: string | null;
  };
  today: {
    logged: number;
    completed: number;
    due: number;
  };
  thisWeek: {
    logged: number;
    byType: Record<string, number>;
  };
}

export interface ContactCard {
  id: string;
  name: string;
  company: string | null;
  avatarUrl: string | null;
  themeColor: string | null;
  relationshipScore: number;
  /**
   * The newest interaction, so a ring can tell "no interactions yet" from a
   * score. Every Pulse card names a tracked contact.
   */
  lastContactedAt: string | null;
}

/** A tracked contact whose clock is past its cadence. */
export interface CatchUpCard extends ContactCard {
  cadenceDays: number;
  /** Days since `lastContactedAt`, or since `trackedAt` when there is none. */
  daysSince: number;
  /** `daysSince - cadenceDays`, always above zero. */
  overshootDays: number;
}

/** The state of the people an account tracks. */
export interface TrackingSummary {
  count: number;
  bands: { strong: number; fading: number; atRisk: number; unscored: number };
  catchUpCount: number;
  startedLast30d: number;
  snapshotWeeks: number;
  rising: MomentumCard[];
  cooling: MomentumCard[];
}

export interface MomentumCard extends ContactCard {
  score: number;
  delta: number;
}

export interface SilentCard extends ContactCard {
  daysSinceContact: number;
  cadenceDays: number;
  overshootDays: number;
}

export interface DashboardMomentumResponse {
  snapshotWeeks: number;
  rising: MomentumCard[];
  cooling: MomentumCard[];
  silent: SilentCard[];
}

export interface StreakInteraction {
  date: string;
  type?: string | null;
  source?: string | null;
}

export interface StreakResult {
  current: number;
  best: number;
  lastDay: string | null;
}

/**
 * Format a Date or date string to local YYYY-MM-DD.
 */
export function toLocalDay(date: Date | string): string {
  if (typeof date === "string") {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match && !date.includes("T")) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Check if dayB is immediately the day after dayA (consecutive local calendar days).
 */
function isConsecutiveDay(dayA: string, dayB: string): boolean {
  const [y, m, d] = dayA.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` === dayB;
}

/**
 * Compute the streak of logged interactions.
 *
 * Rules:
 * - Counts local days with at least one interaction whose `type` is not "import"
 *   and whose `source` is null (or undefined).
 * - Consecutive days ending today or yesterday keep the streak active.
 * - A gap (missing day before yesterday) resets the current streak.
 * - Best streak across all history is preserved.
 * - Timezone of the day boundary is the server's local day.
 */
export function computeStreak(
  interactions: StreakInteraction[],
  now: Date | string = new Date(),
): StreakResult {
  const todayStr = toLocalDay(now);
  const nowDate = typeof now === "string" ? new Date(now) : now;
  const yesterday = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate() - 1,
  );
  const yesterdayStr = toLocalDay(yesterday);

  // 1. Filter qualifying interactions and extract unique local days
  const qualifyingDays = new Set<string>();
  for (const item of interactions) {
    if (!item.date) continue;
    const type = item.type?.toLowerCase();
    if (type === "import") continue;
    if (item.source !== null && item.source !== undefined && item.source !== "")
      continue;

    qualifyingDays.add(toLocalDay(item.date));
  }

  if (qualifyingDays.size === 0) {
    return { current: 0, best: 0, lastDay: null };
  }

  // 2. Sort unique days ascending
  const sortedDays = Array.from(qualifyingDays).sort();

  // 3. Compute best streak
  let best = 0;
  let run = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    if (i === 0 || isConsecutiveDay(sortedDays[i - 1], sortedDays[i])) {
      run++;
    } else {
      run = 1;
    }
    if (run > best) {
      best = run;
    }
  }

  // 4. Compute current streak
  const lastDay = sortedDays[sortedDays.length - 1];
  let current = 0;

  // Streak is active only if the last qualifying day is today or yesterday
  if (lastDay === todayStr || lastDay === yesterdayStr) {
    current = 1;
    for (let i = sortedDays.length - 1; i > 0; i--) {
      if (isConsecutiveDay(sortedDays[i - 1], sortedDays[i])) {
        current++;
      } else {
        break;
      }
    }
  }

  return { current, best, lastDay };
}
