/**
 * Deduplication API Hooks — React Query hooks for the duplicate detection engine.
 *
 * Provides `useDedupeSuggestions` for fetching AI/algorithmic duplicate pairs
 * and `useMergeContacts` for executing single-transaction merges.
 *
 * @module api/dedupe
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { DedupeSuggestion } from '../types';

const API_BASE = '/api';

export const useDedupeSuggestions = (enabled = false) => {
  return useQuery<DedupeSuggestion[]>({
    queryKey: ['dedupe-suggestions'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/dedupe/suggestions`);
      if (!res.ok) throw new Error('Failed to fetch dedupe suggestions');
      return res.json();
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
};

export const useMergeContacts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ primaryId, duplicateId }: { primaryId: string; duplicateId: string }) => {
      const res = await fetch(`${API_BASE}/contacts/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId, duplicateId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Merge failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dedupe-suggestions'] });
    },
  });
};

export const useSeedDuplicates = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/dev/seed-duplicates`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to seed duplicates');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['dedupe-suggestions'] });
    },
  });
};
