import React, { createContext, useContext, useState, Dispatch, SetStateAction } from 'react';
import type { SemanticSearchResult } from '../types';

interface SessionContextValue {
  // Network Page persistence
  lastContactId: string | null;
  setLastContactId: Dispatch<SetStateAction<string | null>>;

  // AI Search persistence
  lastAISearchQuery: string;
  setLastAISearchQuery: Dispatch<SetStateAction<string>>;
  lastAISearchData: SemanticSearchResult | null;
  setLastAISearchData: Dispatch<SetStateAction<SemanticSearchResult | null>>;
  lastAISearchPhase: 'idle' | 'instant' | 'enriching' | 'done';
  setLastAISearchPhase: Dispatch<SetStateAction<'idle' | 'instant' | 'enriching' | 'done'>>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [lastContactId, setLastContactId] = useState<string | null>(null);
  
  const [lastAISearchQuery, setLastAISearchQuery] = useState('');
  const [lastAISearchData, setLastAISearchData] = useState<SemanticSearchResult | null>(null);
  const [lastAISearchPhase, setLastAISearchPhase] = useState<'idle' | 'instant' | 'enriching' | 'done'>('idle');

  return (
    <SessionContext.Provider value={{
      lastContactId,
      setLastContactId,
      lastAISearchQuery,
      setLastAISearchQuery,
      lastAISearchData,
      setLastAISearchData,
      lastAISearchPhase,
      setLastAISearchPhase,
    }}>
      {children}
    </SessionContext.Provider>
  );
}
