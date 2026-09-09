import { z } from "zod";
import { readNdjson } from "./ndjson";
import type { FacetFilter } from "../../shared/searchFacets";
import { apiFetch } from "./client";
/** Search hooks validate streamed results and cancel obsolete requests. */
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Contact, SemanticSearchResult } from "../types";

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
      if (!res.ok) throw new Error("Failed to search contacts");
      return res.json();
    },
    enabled: q.trim().length > 0,
    // CRITICAL: keepPreviousData prevents the result list from emptying and
    // re-filling on every debounced keystroke. Without this, each new query key
    // starts with data=undefined → layout shift → results reappear. With it,
    // the previous FTS5 results are held as placeholder while the new query
    // resolves, creating a seamless "results refine" experience.
    //
    // The companion `isPlaceholderData` flag is available to consumers that
    // want to visually dim stale placeholder results (e.g. opacity-70).
    placeholderData: keepPreviousData,
  });
};

/**
 * Two-phase streaming semantic search hook.
 */
export const useSemanticSearch = (externalState?: {
  data: SemanticSearchResult | null;
  setData: Dispatch<SetStateAction<SemanticSearchResult | null>>;
  phase: "idle" | "instant" | "enriching" | "done";
  setPhase: Dispatch<SetStateAction<"idle" | "instant" | "enriching" | "done">>;
}) => {
  const [internalData, setInternalData] = useState<SemanticSearchResult | null>(
    null,
  );
  const [internalPhase, setInternalPhase] = useState<
    "idle" | "instant" | "enriching" | "done"
  >("idle");

  const data = externalState ? externalState.data : internalData;
  const setData = externalState ? externalState.setData : setInternalData;
  const phase = externalState ? externalState.phase : internalPhase;
  const setPhase = externalState ? externalState.setPhase : setInternalPhase;

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );
  const mutate = useCallback(
    async (query: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const current = () =>
        abortRef.current === controller && !controller.signal.aborted;
      setIsPending(true);
      setError(null);
      setIsSuccess(false);
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
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
        await readNdjson(
          response,
          (value) => {
            if (!current()) return;
            const chunk = searchChunkSchema.parse(value);
            if (chunk.phase === "error") throw new Error(chunk.error);
            if (complete)
              throw new Error("The server sent data after search completed.");
            setData({
              matches:
                chunk.matches as unknown as SemanticSearchResult["matches"],
              fallback: chunk.fallback,
            });
            complete = chunk.phase === "complete" || chunk.phase === "enriched";
            setPhase(complete ? "done" : "enriching");
            setIsSuccess(complete);
          },
          controller.signal,
        );
        if (!complete)
          throw new Error(
            "The search connection ended early. Please try again.",
          );
      } catch (cause) {
        if (current()) {
          setError(cause instanceof Error ? cause : new Error("Search failed"));
          setIsSuccess(false);
        }
      } finally {
        if (current()) {
          setIsPending(false);
          setPhase("done");
        }
      }
    },
    [setData, setPhase],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setData(null);
    setPhase("idle");
    setIsPending(false);
    setError(null);
    setIsSuccess(false);
  }, [setData, setPhase]);

  return {
    data,
    phase,
    isPending,
    isError: !!error,
    isSuccess,
    error,
    mutate,
    reset,
  };
};

const searchChunkSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.enum(["instant", "enriched", "complete"]),
    matches: z
      .array(z.object({ id: z.string(), name: z.string() }).passthrough())
      .max(30),
    fallback: z.boolean(),
  }),
  z.object({ phase: z.literal("error"), error: z.string() }),
]);
