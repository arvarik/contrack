import { useQuery } from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import type { ActionItem, ZeroStatePayload } from "../types";

const API_BASE = "/api";

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
    avgDaysSinceInteraction: number;
    atRiskCount: number;
    totalInteractions30d: number;
    newContacts30d: number;
  };
  atRisk: {
    id: string;
    name: string;
    company: string | null;
    avatarUrl: string | null;
    themeColor: string;
    relationshipScore: number;
    daysSinceContact: number;
    lastInteractionTitle: string | null;
  }[];
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
}

export interface DailyInsight {
  text: string;
  category: string;
  generatedAt: string;
}

export const useDashboard = () => {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async (): Promise<DashboardPayload> => {
      const res = await fetch(`${API_BASE}/dashboard`);
      if (!res.ok) throw new Error("Failed to fetch dashboard payload");
      return res.json();
    },
    staleTime: STALE_TIMES.dashboard,
  });
};

export const useDailyInsight = () => {
  return useQuery({
    queryKey: ["dashboard", "insight"],
    queryFn: async (): Promise<DailyInsight | null> => {
      const res = await fetch(`${API_BASE}/dashboard/insight`);
      if (!res.ok) throw new Error("Failed to fetch daily insight");
      return res.json();
    },
    staleTime: 1000 * 60 * 60 * 2, // 2 hours stale time to prevent multi-fetching AI calls
  });
};

/**
 * Fetch CRM intelligence signals for the Cmd+K command palette zero-state.
 *
 * Returns action items due, at-risk contacts, and ghost alerts — all computed
 * from deterministic SQLite queries (no AI calls). Stale time is 2 minutes so
 * rapid Cmd+K opens don't re-fetch, but the data stays fresh enough to be useful.
 */
export const useZeroState = () => {
  return useQuery({
    queryKey: ["zeroState"],
    queryFn: async (): Promise<ZeroStatePayload> => {
      const res = await fetch(`${API_BASE}/command-palette/zero-state`);
      if (!res.ok) throw new Error("Failed to fetch zero state");
      return res.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
};
