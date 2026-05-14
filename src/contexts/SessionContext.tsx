/**
 * SessionContext — split into TWO narrow contexts so unrelated consumers
 * stop re-rendering on each other's updates.
 *
 * Before (single provider, 5 fields):
 *   typing into the AI search bar updated `lastAISearchQuery` on every
 *   keystroke. That recreated the context value → React broadcast it to
 *   every `useSession()` consumer → `Sidebar` and `App` re-rendered on
 *   every keystroke even though they only read `lastContactId`.
 *
 * After:
 *   - RecentContext  → `lastContactId` (Sidebar + App)
 *   - AISearchSessionContext → AI-search transcript fields (SearchView only)
 *
 * Provider values are also memoized with `useMemo` so an outer-tree re-render
 * (e.g. parent state change unrelated to either context) does NOT recreate
 * the value reference and re-fire all consumers. The compatibility shim
 * `useSession()` is preserved for the existing call sites that read multiple
 * fields — it now reads from both contexts but does NOT broadcast updates
 * across the boundary.
 */
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  Dispatch,
  SetStateAction,
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

// =============================================================================
// Compatibility Shim
// =============================================================================
// Existing call sites destructure `lastContactId, setLastContactId,
// lastAISearchQuery, ...` from a single `useSession()`. We keep that API
// alive but route reads through BOTH inner contexts. Components that only
// read from one slice should migrate to `useRecent()` / `useAISearchSession()`
// to gain the re-render isolation; the shim itself will re-render on any
// change in either slice (same behavior as the old monolithic provider for
// that one component, but the rest of the app no longer pays the cost).

export function useSession() {
  const recent = useRecent();
  const ai = useAISearchSession();
  return {
    ...recent,
    ...ai,
  };
}
