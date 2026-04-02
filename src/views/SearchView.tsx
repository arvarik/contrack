import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, Search, Briefcase, Building, MapPin, Globe, Tag,
  ArrowRight, Loader2, AlertTriangle, ChevronLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSemanticSearch } from '../api';
import type { SemanticMatch } from '../types';
import {
  PAGE_TITLE, SECTION_BG, TAG_PILL, CARD, ICON_BTN,
} from '../lib/styles';
import { cn } from '../lib/utils';

// =============================================================================
// SearchView — Dedicated full-page "Ask My CRM" semantic search
// =============================================================================

const EXAMPLE_QUERIES = [
  'Who do I know in London working in FinTech?',
  'Who likes espresso?',
  "Who haven't I contacted in over 3 months?",
  'Who works at a startup as a designer?',
  'Who do I know in venture capital?',
  'Find people interested in AI or machine learning',
];

// ─── Result Card ─────────────────────────────────────────────────────────────

const ResultCard = ({
  match,
  index,
  isFallback,
  onClick,
}: {
  match: SemanticMatch;
  index: number;
  isFallback: boolean;
  onClick: () => void;
}) => (
  <motion.button
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.05, duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
    onClick={onClick}
    className="w-full text-left group"
  >
    <div className={cn(
      CARD,
      'flex items-start gap-4 hover:shadow-md hover:scale-[1.005] transition-all duration-200 cursor-pointer',
      'group-hover:ring-2 group-hover:ring-primary/20',
    )}>
      <img
        src={match.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(match.name)}`}
        alt=""
        className="w-12 h-12 rounded-full bg-surface-container-high object-cover shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Name + fallback badge */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-on-surface truncate">{match.name}</span>
          {isFallback && (
            <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded shrink-0">
              Keyword
            </span>
          )}
        </div>

        {/* Role / Company / Location */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-on-surface-variant">
          {match.role && (
            <span className="flex items-center gap-1">
              <Briefcase className="w-3 h-3" />{match.role}
            </span>
          )}
          {match.company && (
            <span className="flex items-center gap-1">
              <Building className="w-3 h-3" />{match.company}
            </span>
          )}
          {match.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />{match.location}
            </span>
          )}
          {match.industry && (
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3" />{match.industry}
            </span>
          )}
        </div>

        {/* AI Reason */}
        {match.aiReason && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 + 0.15 }}
            className="flex items-start gap-1.5 mt-1"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary/60 shrink-0 mt-0.5" />
            <span className="text-sm text-primary/80 italic leading-snug">{match.aiReason}</span>
          </motion.div>
        )}

        {/* Tags */}
        {match.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {match.tags.slice(0, 5).map(t => (
              <span key={t.id} className={TAG_PILL}>{t.tag}</span>
            ))}
            {match.tags.length > 5 && (
              <span className="text-[10px] text-on-surface-variant opacity-50">+{match.tags.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {/* Arrow */}
      <ArrowRight className="w-4 h-4 text-on-surface-variant opacity-0 group-hover:opacity-60 transition-opacity shrink-0 mt-2" />
    </div>
  </motion.button>
);

// ─── Shimmer Skeleton ────────────────────────────────────────────────────────

const ShimmerCard = ({ delay = 0 }: { delay?: number }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay }}
    className={cn(CARD, 'flex items-start gap-4')}
  >
    <div className="w-12 h-12 rounded-full bg-primary/10 animate-pulse shrink-0" />
    <div className="flex-1 space-y-2.5 py-1">
      <div className="h-4 bg-primary/10 rounded-full animate-pulse w-1/3" />
      <div className="h-3 bg-surface-container-high rounded-full animate-pulse w-3/5" />
      <div className="h-3 bg-surface-container rounded-full animate-pulse w-4/5" />
    </div>
  </motion.div>
);

// ─── Main SearchView Component ───────────────────────────────────────────────

export const SearchView = () => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const semanticSearch = useSemanticSearch();
  const prevQueryRef = useRef('');

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = useCallback((searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (q.length < 3 || q === prevQueryRef.current) return;
    prevQueryRef.current = q;
    semanticSearch.mutate(q);
  }, [query, semanticSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    } else if (e.key === 'Escape') {
      setQuery('');
      (e.target as HTMLInputElement).blur();
    }
  }, [handleSearch]);

  // Global keydown for focusing search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const handleExampleClick = useCallback((exampleQuery: string) => {
    setQuery(exampleQuery);
    prevQueryRef.current = '';
    semanticSearch.mutate(exampleQuery);
  }, [semanticSearch]);

  const results = semanticSearch.data?.matches ?? [];
  const isFallback = semanticSearch.data?.fallback ?? false;
  const isLoading = semanticSearch.isPending;
  const hasSearched = semanticSearch.isSuccess || semanticSearch.isError;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      {/* Header */}
      <header className={cn(SECTION_BG, 'p-6 shrink-0')}>
        <div className="flex items-center gap-4">
          <Link to="/" className={ICON_BTN}>
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className={cn(PAGE_TITLE, 'flex items-center gap-3')}>
              <div className="p-2 bg-primary/10 rounded-xl">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              Ask My CRM
            </h1>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Semantic AI search — powered by Gemini
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
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your network... (/)"
                className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-on-surface placeholder:text-on-surface-variant/50 text-lg"
              />
              <button
                onClick={() => handleSearch()}
                disabled={query.trim().length < 3 || isLoading}
                className="px-4 py-2 signature-gradient text-white font-bold text-sm rounded-xl hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
            </div>
          </div>

          {/* Example queries (shown when no search has been done) */}
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
                    <span className="text-primary/50 group-hover:text-primary mr-1.5 font-bold">?</span>
                    {q}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Loading shimmer */}
          <AnimatePresence>
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-widest mb-4">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Asking Gemini...
                </div>
                <ShimmerCard delay={0} />
                <ShimmerCard delay={0.08} />
                <ShimmerCard delay={0.16} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results */}
          <AnimatePresence mode="wait">
            {!isLoading && results.length > 0 && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {/* Results header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-primary">
                      {isFallback ? 'Keyword Results' : 'AI Results'}
                    </span>
                    <span className="text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
                      {results.length} match{results.length !== 1 ? 'es' : ''}
                    </span>
                  </div>
                  {isFallback && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                      <span>AI unavailable — showing keyword matches</span>
                    </div>
                  )}
                </div>

                {/* Result cards */}
                <div className="space-y-2">
                  {results.map((match, i) => (
                    <ResultCard
                      key={match.id}
                      match={match}
                      index={i}
                      isFallback={isFallback}
                      onClick={() => navigate(`/contact/${match.id}`)}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* No results */}
          {!isLoading && hasSearched && results.length === 0 && !semanticSearch.isError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="p-4 bg-surface-container-low rounded-2xl mb-4">
                <Search className="w-10 h-10 text-on-surface-variant/30" />
              </div>
              <p className="font-bold text-on-surface mb-1">No matches found</p>
              <p className="text-sm text-on-surface-variant">
                Try rephrasing your query, or check if your contacts have relevant details filled in.
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
                {(semanticSearch.error as Error)?.message || 'An unexpected error occurred.'}
              </p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
