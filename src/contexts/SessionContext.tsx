/**
 * SessionContext — split into TWO narrow contexts so unrelated consumers
 * stop re-rendering on each other's updates.
 *
 * One provider would broadcast every keystroke of the AI search bar to every
 * consumer, so `Sidebar` and `App` would re-render on each one even though
 * they only read `lastContactId`. Two contexts keep the two apart:
 *   - RecentContext  → `lastContactId` (Sidebar + App)
 *   - AISearchSessionContext → the Ask page's search (SearchView only)
 *
 * The recent value is memoized with `useMemo` so an outer-tree re-render
 * (e.g. parent state change unrelated to either context) does NOT recreate
 * the value reference and re-fire its consumers.
 */
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useSemanticSearch } from "../api/search";

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
// AISearchSessionContext — the Ask page's search, which outlives the page
// =============================================================================

interface AISearchSessionValue {
  lastAISearchQuery: string;
  setLastAISearchQuery: Dispatch<SetStateAction<string>>;
  /**
   * The search itself, held here rather than in the page, so a question
   * asked on Ask is still answered after the reader leaves, and the answer
   * is on screen when they come back.
   */
  semanticSearch: ReturnType<typeof useSemanticSearch>;
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
  // Not memoized: the search is a new object on every render, and this
  // provider renders when it changes.
  const [lastAISearchQuery, setLastAISearchQuery] = useState("");
  const semanticSearch = useSemanticSearch();
  const aiSearchValue: AISearchSessionValue = {
    lastAISearchQuery,
    setLastAISearchQuery,
    semanticSearch,
  };

  return (
    <RecentContext.Provider value={recentValue}>
      <AISearchSessionContext.Provider value={aiSearchValue}>
        {children}
      </AISearchSessionContext.Provider>
    </RecentContext.Provider>
  );
}
