/** Search hooks validate streamed results and cancel obsolete requests. */
import { z } from "zod";
import { readNdjson } from "./ndjson";
import type { FacetFilter } from "../../shared/searchFacets";
import { apiFetch } from "./client";
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { StarterQuestionsResponse } from "../../shared/starterQuestions";
import { useState, useCallback, useRef } from "react";
import type {
  Contact,
  InteractionSearchResult,
  SemanticSearchResult,
} from "../types";

export const useSearchContacts = (q: string, filters: FacetFilter[] = []) => {
  return useQuery({
    queryKey: ["contacts", "search", q, filters],
    queryFn: async ({ signal }): Promise<Contact[]> => {
      const res = await apiFetch(
        `/search?q=${encodeURIComponent(q)}&filters=${encodeURIComponent(JSON.stringify(filters))}`,
        {
          signal,
        },
      );
      return res.json();
    },
    enabled: q.trim().length > 0,
    // Keeps the last results while the next query resolves, so the list does
    // not empty and refill on each debounced keystroke.
    placeholderData: keepPreviousData,
  });
};

/**
 * Two-phase streaming semantic search. Leaving the page does not cancel a
 * question: Ask reads this hook from `SessionContext`, so the answer lands
 * while the reader is elsewhere.
 */
export const useSemanticSearch = () => {
  const [data, setData] = useState<SemanticSearchResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "instant" | "enriching" | "done">(
    "idle",
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  /**
   * The last question asked, or null. Set before the request leaves, so a
   * caller can tell a question still being answered from a new one, and
   * kept through an error, for Retry.
   */
  const [askedQuery, setAskedQuery] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Ask a question. `filters` are the palette's facet pills. The server also
   * reads facets typed into the question, and counts a facet sent both ways
   * once.
   */
  const mutate = useCallback(
    async (query: string, filters: FacetFilter[] = []) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const current = () =>
        abortRef.current === controller && !controller.signal.aborted;
      setIsPending(true);
      setError(null);
      setIsSuccess(false);
      setAskedQuery(query);
      setPhase("idle");
      setData(null);
      let complete = false;
      try {
        const response = await apiFetch("/search/semantic", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify(filters.length ? { query, filters } : { query }),
          signal: controller.signal,
        });
        await readNdjson(
          response,
          (value) => {
            if (!current()) return;
            const chunk = searchChunkSchema.parse(value);
            if (chunk.phase === "error") throw new Error(chunk.error);
            if (complete)
              throw new Error("The server sent data after search completed");
            setData({
              query,
              matches:
                chunk.matches as unknown as SemanticSearchResult["matches"],
              fallback: chunk.fallback,
              total: chunk.total,
              facets: chunk.facets,
              refine: chunk.refine,
            });
            complete = chunk.phase === "complete" || chunk.phase === "enriched";
            setPhase(complete ? "done" : "enriching");
            setIsSuccess(complete);
          },
          controller.signal,
        );
        if (!complete)
          throw new Error("The search connection ended early. Try again");
      } catch (cause) {
        if (current()) {
          setError(cause instanceof Error ? cause : new Error("Search failed"));
          setIsSuccess(false);
          // A partial answer is not a completed result.
          setData(null);
        }
      } finally {
        if (current()) {
          setIsPending(false);
          setPhase("done");
          abortRef.current = null;
        }
      }
    },
    [],
  );

  /**
   * Forget the question. With `cancel` false its request keeps running and
   * its answer is dropped here, but the server finishes it and keeps it in
   * its cache, so asking the same question again is answered at once.
   */
  const reset = useCallback((cancel = true) => {
    if (cancel) abortRef.current?.abort();
    abortRef.current = null;
    setData(null);
    setPhase("idle");
    setIsPending(false);
    setError(null);
    setIsSuccess(false);
    setAskedQuery(null);
  }, []);

  /** The question this search is about, or "" when there is none. */
  const submittedQuery = askedQuery ?? "";

  return {
    data,
    phase,
    isPending,
    isError: !!error,
    isSuccess,
    error,
    submittedQuery,
    mutate,
    reset,
  };
};

const searchChunkSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.enum(["instant", "enriched", "complete"]),
    matches: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            verified: z.boolean().optional(),
          })
          .passthrough(),
      )
      .max(30),
    fallback: z.boolean(),
    total: z.number().int().nonnegative().optional(),
    facets: z.string().optional(),
    refine: z
      .array(
        z.object({
          facet: z.string(),
          label: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .max(10)
      .optional(),
  }),
  z.object({ phase: z.literal("error"), error: z.string() }),
]);

export interface FailedIndexItem {
  contactId: string;
  name: string;
  error: string;
  attempts: number;
  queuedAt: string;
}

export interface SearchCoverage {
  total: number;
  indexed: number;
  missing: number;
  pending: number;
  failed: number;
  coverage: number;
  isIndexing: boolean;
  provider: {
    kind: "builtin" | "provider";
    providerId: string | null;
    model: string | null;
    isPaid: boolean;
  };
  failedItems: FailedIndexItem[];
}

interface RefreshIndexResponse {
  ok: boolean;
  queued: number;
  message: string;
  requiresExplicitConfirmation?: boolean;
  provider?: string | null;
  model?: string | null;
  missingCount?: number;
}

/** The account's semantic index coverage and queue. */
export const useSearchCoverage = () => {
  return useQuery<SearchCoverage>({
    queryKey: ["search", "coverage"],
    queryFn: async (): Promise<SearchCoverage> => {
      const res = await apiFetch("/search/coverage");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.isIndexing || data.pending > 0)) return 2000;
      return 15000;
    },
  });
};

/**
 * The starter questions for "Try asking" on Ask. The key sits under
 * `contacts`, so a change that refreshes the contacts refreshes the pool.
 * The app fetches it in an idle moment after it loads.
 */
export const starterQuestionsQuery = () =>
  queryOptions({
    queryKey: ["contacts", "starters"] as const,
    queryFn: async ({ signal }): Promise<StarterQuestionsResponse> => {
      const res = await apiFetch("/search/starters", { signal });
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

/** The starter question pool. See {@link starterQuestionsQuery}. */
export const useStarterQuestions = () => useQuery(starterQuestionsQuery());

/** Indexes the missing contacts, or all of them. */
export const useRefreshSearchIndex = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params?: {
      allowProvider?: boolean;
      forceAll?: boolean;
    }): Promise<RefreshIndexResponse> => {
      const res = await apiFetch("/search/refresh-index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params ?? {}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search", "coverage"] });
    },
  });
};

// Note search: notes with the date and the passage that matched

/** The query-key prefix every note search shares, for invalidation. */
export const INTERACTION_SEARCH_KEY = ["interactions", "search"] as const;

interface InteractionSearchParams {
  q: string;
  /** A calendar date (`YYYY-MM-DD`, a whole day) or an ISO instant. */
  from?: string;
  to?: string;
  type?: string;
  contactId?: string;
  sort?: "relevance" | "date";
  mode?: "auto" | "all" | "any";
  limit?: number;
  offset?: number;
}

/** The browser's IANA zone, so "last month" is the reader's month. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The query string for a note search, with empty fields left out. */
function interactionSearchQueryString(params: InteractionSearchParams): string {
  const query = new URLSearchParams();
  const entries: [string, string | number | undefined][] = [
    ["q", params.q],
    ["from", params.from],
    ["to", params.to],
    ["type", params.type],
    ["contactId", params.contactId],
    ["sort", params.sort],
    ["mode", params.mode],
    ["limit", params.limit],
    ["offset", params.offset],
    ["tz", browserTimeZone()],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.toString();
}

/**
 * Searches the notes, once there is text, a period, a kind or a contact to
 * search for.
 */
export const useInteractionSearch = (params: InteractionSearchParams) => {
  const active = Boolean(
    params.q.trim() ||
    params.from ||
    params.to ||
    params.type ||
    params.contactId,
  );
  return useQuery({
    queryKey: [...INTERACTION_SEARCH_KEY, params],
    queryFn: async ({ signal }): Promise<InteractionSearchResult> => {
      const res = await apiFetch(
        `/search/interactions?${interactionSearchQueryString(params)}`,
        { signal },
      );
      return res.json();
    },
    enabled: active,
    // The last answer stays while the next loads, but not once there is
    // nothing to search for, or a cleared search keeps its notes.
    placeholderData: (previous) => (active ? previous : undefined),
  });
};
