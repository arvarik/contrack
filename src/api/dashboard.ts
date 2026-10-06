import { apiFetch } from "./client";
import { browserTimeZone } from "./search";
import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import type { ActionItem, ZeroStatePayload } from "../types";
import type {
  CatchUpCard,
  DashboardActivityResponse,
  TrackingSummary,
} from "../../shared/pulse";

export interface DashboardPayload {
  overdue: ActionItem[];
  dueToday: ActionItem[];
  upcoming: ActionItem[];
  ghosts: {
    id: string;
    name: string;
    company: string | null;
    avatarUrl: string | null;
    themeColor: string;
    mentionCount: number;
  }[];
  metrics: {
    totalActive: number;
    newContacts30d: number;
  };
  /** Tracked contacts past their cadence, the furthest first, ten at most. */
  catchUp: CatchUpCard[];
  /** The state of the people this account tracks: the Keeping up card. */
  tracking: TrackingSummary;
  recentlyAdded: {
    id: string;
    name: string;
    company: string | null;
    avatarUrl: string | null;
    themeColor: string;
    addedAt: string;
  }[];
  industryComposition: {
    industry: string;
    count: number;
  }[];
  locationComposition: {
    location: string;
    count: number;
  }[];
  roleComposition: {
    role: string;
    count: number;
  }[];
  interactionBreakdown30d: {
    type: string;
    count: number;
  }[];
  networkGrowthTimeline30d: {
    id: string;
    name: string;
    company: string | null;
    avatarUrl: string | null;
    themeColor: string;
    addedAt: string;
  }[];
  hygiene: {
    missingCompany: number;
    missingLocation: number;
    missingEmail: number;
    stale: number;
  };
  meetings: {
    title: string;
    startsAt: string;
    endsAt: string;
    contactIds: string[];
  }[];
  correspondents: number;
}

export interface DailyInsight {
  text: string;
  category: string;
  generatedAt: string;
}

/**
 * `?tz=` with the browser's zone, so "today" on the server is the reader's
 * day: Pulse's groups, its activity, the badge and the palette's count.
 */
export function zoneQuery(): string {
  const tz = browserTimeZone();
  return tz ? `?tz=${encodeURIComponent(tz)}` : "";
}

const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: async ({ signal }): Promise<DashboardPayload> => {
    const res = await apiFetch(`/dashboard${zoneQuery()}`, { signal });
    if (!res.ok) throw new Error("Failed to fetch dashboard payload");
    return res.json();
  },
  staleTime: STALE_TIMES.dashboard,
});

const dashboardActivityQuery = queryOptions({
  queryKey: ["dashboard", "activity"],
  queryFn: async ({ signal }): Promise<DashboardActivityResponse> => {
    const res = await apiFetch(`/dashboard/activity${zoneQuery()}`, {
      signal,
    });
    if (!res.ok) throw new Error("Failed to fetch dashboard activity");
    return res.json();
  },
  staleTime: STALE_TIMES.dashboard,
});

export const useDashboard = () => useQuery(dashboardQuery);

export const useDashboardActivity = () => useQuery(dashboardActivityQuery);

/**
 * Starts the data Pulse draws first, for a link to Pulse a person points at.
 *
 * Without it, Pulse's data was asked for only once its page had mounted, so
 * the first visit drew the page's card skeleton after its code arrived. Data
 * read a moment ago is not read again (`staleTime`). The daily insight is
 * left out: it can cost an AI call, and a pointer passing over the link is
 * not a reason to make one.
 */
export function prefetchPulse(queryClient: QueryClient): void {
  void queryClient.prefetchQuery(dashboardQuery);
  void queryClient.prefetchQuery(dashboardActivityQuery);
}

export const useDailyInsight = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ["dashboard", "insight"],
    queryFn: async ({ signal }): Promise<DailyInsight | null> => {
      const res = await apiFetch(`/dashboard/insight`, { signal });
      if (!res.ok) throw new Error("Failed to fetch daily insight");
      return res.json();
    },
    staleTime: 1000 * 60 * 60 * 2, // 2 hours stale time to prevent multi-fetching AI calls
    enabled: options?.enabled,
  });
};

/**
 * Fetch CRM intelligence signals for the Cmd+K command palette zero-state.
 *
 * Returns action items due, catch-ups, and ghost alerts — all computed
 * from deterministic SQLite queries (no AI calls). Stale time is 2 minutes so
 * rapid Cmd+K opens don't re-fetch, but the data stays fresh enough to be useful.
 */
export const useZeroState = () => {
  return useQuery({
    queryKey: ["zeroState"],
    queryFn: async ({ signal }): Promise<ZeroStatePayload> => {
      const res = await apiFetch(`/command-palette/zero-state${zoneQuery()}`, {
        signal,
      });
      if (!res.ok) throw new Error("Failed to fetch zero state");
      return res.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
};
