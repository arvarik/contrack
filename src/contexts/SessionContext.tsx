/**
 * Two narrow contexts, so a keystroke in Ask's search does not redraw the
 * readers of `lastContactId` (`Sidebar` and `App`):
 *   - RecentContext: `lastContactId`
 *   - AISearchSessionContext: the Ask page's search
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

// RecentContext: the last contact viewed, for the list's scroll position

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

// AISearchSessionContext: the Ask page's search, which outlives the page

interface AISearchSessionValue {
  lastAISearchQuery: string;
  setLastAISearchQuery: Dispatch<SetStateAction<string>>;
  /** Held here, not in the page, so a question is answered after the reader leaves. */
  semanticSearch: ReturnType<typeof useSemanticSearch>;
}

const AISearchSessionContext = createContext<AISearchSessionValue | null>(null);

export function useAISearchSession(): AISearchSessionValue {
  const ctx = useContext(AISearchSessionContext);
  if (!ctx)
    throw new Error("useAISearchSession must be used within SessionProvider");
  return ctx;
}

// One provider component mounts both.

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // ── Recent (narrow, low-churn) ──────────────────────────────────────
  const [lastContactId, setLastContactId] = useState<string | null>(null);

  const recentValue = useMemo<RecentContextValue>(
    () => ({ lastContactId, setLastContactId }),
    [lastContactId],
  );

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
