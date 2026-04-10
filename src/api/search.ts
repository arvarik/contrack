/**
 * Search API Hooks — React Query hooks for FTS5 keyword and Ask Contrack v3 semantic search.
 *
 * v3 uses NDJSON streaming for two-phase delivery:
 *   Phase 1 (instant): results appear in <15ms
 *   Phase 2 (enriched): AI reasons fade in ~500ms later
 *
 * @module api/search
 */
import { useQuery } from '@tanstack/react-query';
import { useState, useCallback, useRef } from 'react';
import type { Contact, SemanticSearchResult } from '../types';

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

/**
 * Two-phase streaming semantic search hook.
 *
 * Returns:
 * - `data`: the current best results (Phase 1 → Phase 2 progressive update)
 * - `phase`: "idle" | "instant" | "enriching" | "done"
 * - `search(query)`: trigger a search
 */
export const useSemanticSearch = () => {
  const [data, setData] = useState<SemanticSearchResult | null>(null);
  const [phase, setPhase] = useState<'idle' | 'instant' | 'enriching' | 'done'>('idle');
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const mutate = useCallback(async (query: string) => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsPending(true);
    setIsError(false);
    setIsSuccess(false);
    setPhase('idle');
    setData(null);

    try {
      const res = await fetch(`${API_BASE}/search/semantic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/x-ndjson',
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('Semantic search failed');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete NDJSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete last line

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line);

            if (chunk.phase === 'instant') {
              // Phase 1: show results immediately
              setData({
                matches: chunk.matches,
                fallback: chunk.fallback,
              });
              setPhase(chunk.highConfidence ? 'done' : 'enriching');
              setIsSuccess(true);
            } else if (chunk.phase === 'enriched') {
              // Phase 2: replace with AI-enriched results
              setData({
                matches: chunk.matches,
                fallback: chunk.fallback,
              });
              setPhase('done');
              setIsSuccess(true);
            } else if (chunk.phase === 'complete') {
              // Single-phase response (cache hit or short-circuit)
              setData({
                matches: chunk.matches,
                fallback: chunk.fallback,
              });
              setPhase('done');
              setIsSuccess(true);
            }
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setIsError(true);
        console.error('Semantic search error:', err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsPending(false);
        setPhase(prev => prev === 'idle' ? 'done' : prev);
      }
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setData(null);
    setPhase('idle');
    setIsPending(false);
    setIsError(false);
    setIsSuccess(false);
  }, []);

  return {
    data,
    phase,
    isPending,
    isError,
    isSuccess,
    error: isError ? new Error('Semantic search failed') : null,
    mutate,
    reset,
  };
};
