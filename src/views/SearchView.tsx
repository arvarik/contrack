import React, { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { isTypingTarget } from "../lib/keyboard";
import { Sparkles, Search, Tag, X, Loader2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useSemanticSearch } from "../api";
import type { SemanticMatch } from "../types";
import { PAGE_TITLE, SECTION_BG } from "../lib/styles";
import { cn } from "../lib/utils";
import { FloatingContactCard } from "../components/FloatingContactCard";
import { SynthesisBar } from "../components/command-palette/SynthesisBar";
import { usePageTitle } from "../hooks/usePageTitle";
import { ResultCard, ShimmerCard } from "./search/SearchResultCards";
import { useSession } from "../contexts/SessionContext";

// =============================================================================
// SearchView — Dedicated full-page "Ask Contrack" semantic search
// =============================================================================

const EXAMPLE_QUERIES = [
  "Who do I know in London working in FinTech?",
  "Who likes espresso?",
  "Who haven't I contacted in over 3 months?",
  "Who works at a startup as a designer?",
  "Who do I know in venture capital?",
  "Find people interested in AI or machine learning",
];

// ─── Main SearchView Component ────────────────────────────────────────────────

export const SearchView = () => {
  const mountStart = useRef(performance.now());
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(
        `[Perf] SearchView mounted in ${(performance.now() - mountStart.current).toFixed(2)}ms`,
      );
    }
  }, []);

  const navigate = useNavigate();
  const {
    lastAISearchQuery,
    setLastAISearchQuery,
    lastAISearchData,
    setLastAISearchData,
    lastAISearchPhase,
    setLastAISearchPhase,
  } = useSession();

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(lastAISearchQuery);

  const semanticSearch = useSemanticSearch({
    data: lastAISearchData,
    setData: setLastAISearchData,
    phase: lastAISearchPhase,
    setPhase: setLastAISearchPhase,
  });

  const prevQueryRef = useRef(lastAISearchQuery);
  const [floatingContactId, setFloatingContactId] = useState<string | null>(
    null,
  );

  // Read ?q= URL param on mount (from Cmd+K "Open in full-page search" bridge)
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQueryHandled = useRef(false);

  usePageTitle("AI Search");

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-fire search if ?q= param is present on mount
  useEffect(() => {
    if (initialQueryHandled.current) return;
    const urlQuery = searchParams.get("q");
    if (urlQuery && urlQuery.trim().length >= 3) {
      initialQueryHandled.current = true;
      setQuery(urlQuery.trim());
      // Clear the param to avoid re-firing on back navigation
      setSearchParams({}, { replace: true });
      // Defer search to next tick so query state is set
      queueMicrotask(() => {
        prevQueryRef.current = urlQuery.trim();
        semanticSearch.mutate(urlQuery.trim());
      });
    }
  }, [searchParams, setSearchParams, semanticSearch]);

  const handleSearch = useCallback(
    (searchQuery?: string) => {
      const q = (searchQuery ?? query).trim();
      if (q.length < 3 || q === prevQueryRef.current) return;
      prevQueryRef.current = q;
      setLastAISearchQuery(q);
      semanticSearch.mutate(q);
    },
    [query, semanticSearch, setLastAISearchQuery],
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setLastAISearchQuery("");
    semanticSearch.reset();
    inputRef.current?.focus();
  }, [semanticSearch, setLastAISearchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
      }
    },
    [handleSearch, handleClear],
  );

  // Global keydown for focusing search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const handleExampleClick = useCallback(
    (exampleQuery: string) => {
      setQuery(exampleQuery);
      prevQueryRef.current = "";
      setLastAISearchQuery(exampleQuery);
      semanticSearch.mutate(exampleQuery);
    },
    [semanticSearch, setLastAISearchQuery],
  );

  const results = semanticSearch.data?.matches ?? [];
  const isFallback = semanticSearch.data?.fallback ?? false;
  const isLoading = semanticSearch.isPending && semanticSearch.phase === "idle";
  const isEnriching = semanticSearch.phase === "enriching";
  const hasSearched =
    semanticSearch.isSuccess || semanticSearch.isError || results.length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      {/* Header */}
      <header className={cn(SECTION_BG, "p-6 shrink-0")}>
        <div className="flex items-center gap-4">
          <div>
            <h1 className={cn(PAGE_TITLE, "flex items-center gap-3")}>
              <div className="p-2 bg-primary/10 rounded-xl">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              Ask Contrack
            </h1>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Semantic AI search across your network
            </p>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          {/* Search Input */}
          <div className="relative">
            <div className="flex items-center gap-3 bg-surface-container-lowest rounded-2xl shadow-sm px-5 py-4 focus-within:ring-2 focus-within:ring-primary/30 focus-within:shadow-md transition-all">
              {isLoading ? (
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              ) : (
                <Sparkles className="w-5 h-5 text-primary shrink-0" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your network..."
                className="flex-1 min-w-0 bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder:text-on-surface-variant/50 text-lg"
              />
              <AnimatePresence>
                {query.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => {
                      setQuery("");
                      setLastAISearchQuery("");
                      semanticSearch.reset();
                      inputRef.current?.focus();
                    }}
                    className="p-1.5 rounded-full text-on-surface-variant/50 hover:bg-surface-container-high hover:text-on-surface transition-colors shrink-0"
                    aria-label="Clear search"
                  >
                    <X className="w-5 h-5" />
                  </motion.button>
                )}
              </AnimatePresence>
              <button
                onClick={() => handleSearch()}
                disabled={query.trim().length < 3 || isLoading}
                className="px-4 py-2 bg-primary text-on-primary font-bold text-sm rounded-xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
            </div>
          </div>

          {/* Example queries — only shown before first search */}
          {!hasSearched && !isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="space-y-4"
            >
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                Try asking...
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EXAMPLE_QUERIES.map((q, i) => (
                  <motion.button
                    key={q}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.04 }}
                    onClick={() => handleExampleClick(q)}
                    className="text-left px-4 py-3 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md hover:bg-primary/5 text-sm text-on-surface-variant hover:text-primary transition-all group"
                  >
                    <span className="text-primary/50 group-hover:text-primary mr-1.5 font-bold">
                      ?
                    </span>
                    {q}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/*
            Single AnimatePresence with mode="popLayout" switches between shimmer and results.

            mode="popLayout": when shimmer exits, Framer immediately removes it from
            document flow (position: absolute) so the incoming results section takes its
            natural height from frame 1 — no double-stacking, no layout jump.

            All three states (loading, results, empty/error) share the same keyed slot.
          */}
          <AnimatePresence mode="popLayout">
            {isLoading ? (
              <motion.div
                key="shimmer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-widest mb-4">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Searching...
                </div>
                <ShimmerCard delay={0} />
                <ShimmerCard delay={0.08} />
                <ShimmerCard delay={0.16} />
              </motion.div>
            ) : results.length > 0 ? (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="space-y-3"
              >
                {/* Results header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-primary">
                      {isFallback ? "Keyword Results" : "AI Results"}
                    </span>
                    <span className="text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
                      {results.length} match{results.length !== 1 ? "es" : ""}
                    </span>
                  </div>
                  {isEnriching && (
                    <div className="flex items-center gap-1.5 text-xs text-primary/70">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Enriching with AI…</span>
                    </div>
                  )}
                  {isFallback && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                      <span>AI unavailable — showing keyword matches</span>
                    </div>
                  )}
                </div>

                {/* Synthesis executive brief (Feature 6) */}
                {!isFallback && (
                  <SynthesisBar
                    query={query}
                    contacts={results}
                    resultCount={results.length}
                  />
                )}

                {/* Cards — CSS stagger, no per-card Framer Motion */}
                <div className="space-y-2">
                  {results.map((match, i) => (
                    <ResultCard
                      key={match.id}
                      match={match}
                      index={i}
                      isFallback={isFallback}
                      onClick={() => setFloatingContactId(match.id)}
                    />
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* No results */}
          {!isLoading &&
            hasSearched &&
            results.length === 0 &&
            !semanticSearch.isError && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-16 text-center"
              >
                <div className="p-4 bg-surface-container-low rounded-2xl mb-4">
                  <Search className="w-10 h-10 text-on-surface-variant/30" />
                </div>
                <p className="font-bold text-on-surface mb-1">
                  No matches found
                </p>
                <p className="text-sm text-on-surface-variant">
                  Try rephrasing your query, or check if your contacts have
                  relevant details filled in.
                </p>
              </motion.div>
            )}

          {/* Error state */}
          {semanticSearch.isError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="p-4 bg-rose-500/10 rounded-2xl mb-4">
                <AlertTriangle className="w-10 h-10 text-rose-500" />
              </div>
              <p className="font-bold text-on-surface mb-1">Search failed</p>
              <p className="text-sm text-on-surface-variant">
                {(semanticSearch.error as Error)?.message ||
                  "An unexpected error occurred."}
              </p>
            </motion.div>
          )}
        </div>
      </div>

      {/* Floating Contact Card overlay */}
      <FloatingContactCard
        contactId={floatingContactId}
        isOpen={!!floatingContactId}
        onClose={() => setFloatingContactId(null)}
        showNetworkButton
      />
    </div>
  );
};
