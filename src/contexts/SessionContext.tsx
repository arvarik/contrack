/**
 * SessionContext — split into TWO narrow contexts so unrelated consumers
 * stop re-rendering on each other's updates.
 *
 * One provider would broadcast every keystroke of the AI search bar to every
 * consumer, so `Sidebar` and `App` would re-render on each one even though
 * they only read `lastContactId`. Two contexts keep the two apart:
 *   - RecentContext  → `lastContactId` (Sidebar + App)
 *   - AISearchSessionContext → AI-search transcript fields (SearchView only)
 *
 * Provider values are also memoized with `useMemo` so an outer-tree re-render
 * (e.g. parent state change unrelated to either context) does NOT recreate
 * the value reference and re-fire all consumers.
 */
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SemanticSearchResult } from "../types";

// =============================================================================
// RecentContext — last-viewed-contact cursor (network list scroll restore)
// =============================================================================

interface RecentContextValue {
  lastContactId: string | null;
  setLastContactId: Dispatch<SetStateAction<string | null>>;
}

const RecentContext = createContext<RecentContextValue | null>(null);

export function useRecent(): RecentContextValue {
  const ctx = useContext(RecentContext);
  if (!ctx) throw new Error("useRecent must be used within SessionProvider");
  return ctx;
}

// =============================================================================
// AISearchSessionContext — transcript of the current AI search session
// =============================================================================

type SearchPhase = "idle" | "instant" | "enriching" | "done";

interface AISearchSessionValue {
  lastAISearchQuery: string;
  setLastAISearchQuery: Dispatch<SetStateAction<string>>;
  lastAISearchData: SemanticSearchResult | null;
  setLastAISearchData: Dispatch<SetStateAction<SemanticSearchResult | null>>;
  lastAISearchPhase: SearchPhase;
  setLastAISearchPhase: Dispatch<SetStateAction<SearchPhase>>;
}

const AISearchSessionContext = createContext<AISearchSessionValue | null>(null);

export function useAISearchSession(): AISearchSessionValue {
  const ctx = useContext(AISearchSessionContext);
  if (!ctx)
    throw new Error("useAISearchSession must be used within SessionProvider");
  return ctx;
}

// =============================================================================
// Combined Provider
// =============================================================================
// Two state slices, two memoized provider values. Nesting the providers
// inside one component keeps the public API unchanged — `<SessionProvider>`
// is still the single mount point used by App.tsx and main.tsx.

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // ── Recent (narrow, low-churn) ──────────────────────────────────────
  const [lastContactId, setLastContactId] = useState<string | null>(null);

  const recentValue = useMemo<RecentContextValue>(
    () => ({ lastContactId, setLastContactId }),
    [lastContactId],
  );

  // ── AI Search Session (wide, high-churn) ────────────────────────────
  const [lastAISearchQuery, setLastAISearchQuery] = useState("");
  const [lastAISearchData, setLastAISearchData] =
    useState<SemanticSearchResult | null>(null);
  const [lastAISearchPhase, setLastAISearchPhase] =
    useState<SearchPhase>("idle");

  const aiSearchValue = useMemo<AISearchSessionValue>(
    () => ({
      lastAISearchQuery,
      setLastAISearchQuery,
      lastAISearchData,
      setLastAISearchData,
      lastAISearchPhase,
      setLastAISearchPhase,
    }),
    [lastAISearchQuery, lastAISearchData, lastAISearchPhase],
  );

  return (
    <RecentContext.Provider value={recentValue}>
      <AISearchSessionContext.Provider value={aiSearchValue}>
        {children}
      </AISearchSessionContext.Provider>
    </RecentContext.Provider>
  );
}
