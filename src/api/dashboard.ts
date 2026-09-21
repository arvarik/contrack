import { apiFetch } from "./client";
import { useQuery } from "@tanstack/react-query";
import { STALE_TIMES } from "../lib/queryConfig";
import type { ActionItem, ZeroStatePayload } from "../types";
import type {
  ActivityDay,
  DashboardActivityResponse,
  DashboardMomentumResponse,
  ContactCard,
  MomentumCard,
  SilentCard,
  StreakResult,
} from "../../shared/pulse";

export type {
  ActivityDay,
  DashboardActivityResponse,
  DashboardMomentumResponse,
  ContactCard,
  MomentumCard,
  SilentCard,
  StreakResult,
};

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
    /** The ring needs it: a score with no date is not a score. */
    lastContactedAt: string | null;
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

export const useDashboard = () => {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async ({ signal }): Promise<DashboardPayload> => {
      const res = await apiFetch(`/dashboard`, { signal });
      if (!res.ok) throw new Error("Failed to fetch dashboard payload");
      return res.json();
    },
    staleTime: STALE_TIMES.dashboard,
  });
};

export const useDashboardActivity = () => {
  return useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn: async ({ signal }): Promise<DashboardActivityResponse> => {
      const res = await apiFetch(`/dashboard/activity`, { signal });
      if (!res.ok) throw new Error("Failed to fetch dashboard activity");
      return res.json();
    },
    staleTime: STALE_TIMES.dashboard,
  });
};

export const useDashboardMomentum = () => {
  return useQuery({
    queryKey: ["dashboard", "momentum"],
    queryFn: async ({ signal }): Promise<DashboardMomentumResponse> => {
      const res = await apiFetch(`/dashboard/momentum`, { signal });
      if (!res.ok) throw new Error("Failed to fetch dashboard momentum");
      return res.json();
    },
    staleTime: STALE_TIMES.dashboard,
  });
};

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
 * Returns action items due, at-risk contacts, and ghost alerts — all computed
 * from deterministic SQLite queries (no AI calls). Stale time is 2 minutes so
 * rapid Cmd+K opens don't re-fetch, but the data stays fresh enough to be useful.
 */
export const useZeroState = () => {
  return useQuery({
    queryKey: ["zeroState"],
    queryFn: async ({ signal }): Promise<ZeroStatePayload> => {
      const res = await apiFetch(`/command-palette/zero-state`, { signal });
      if (!res.ok) throw new Error("Failed to fetch zero state");
      return res.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
};
