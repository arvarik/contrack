/**
 * Search API Hooks — React Query hooks for FTS5 keyword and Gemini semantic search.
 * @module api/search
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { Contact, SemanticSearchResult } from '../types';

const API_BASE = '/api';

export const useSearchContacts = (q: string) => {
  return useQuery({
    queryKey: ['contacts', 'search', q],
    queryFn: async (): Promise<Contact[]> => {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Failed to search contacts');
      return res.json();
    },
    enabled: q.length > 0,
  });
};

export const useSemanticSearch = () => {
  return useMutation({
    mutationFn: async (query: string): Promise<SemanticSearchResult> => {
      const res = await fetch(`${API_BASE}/search/semantic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error('Semantic search failed');
      return res.json();
    },
  });
};
