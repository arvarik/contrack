import React, { useState, useCallback, useMemo } from 'react';
import {
  CheckCircle2, Loader2, ChevronDown, ChevronUp,
  ArrowLeftRight, Merge as MergeIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { DedupeSuggestion } from '../../../types';
import { ContactCard } from './shared/ContactCard';
import { MatchBadge } from './shared/MatchBadge';
import { cn } from '../../../lib/utils';
import { CARD } from '../../../lib/styles';
import { toast } from 'sonner';
import { useMergeContacts, useMergeBatch } from '../../../api';
import { fallbackAvatarUrl } from '../../../lib/avatar';

// =============================================================================
// SuggestionList — Table/list view of all duplicate suggestions
// =============================================================================

interface SuggestionListProps {
  suggestions: DedupeSuggestion[];
  onRemoveSuggestion: (id: string) => void;
}

export const SuggestionList = ({ suggestions, onRemoveSuggestion }: SuggestionListProps) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [swapped, setSwapped] = useState<Set<string>>(new Set());
  const mergeContacts = useMergeContacts();
  const mergeBatch = useMergeBatch();

  const allSelected = suggestions.length > 0 && selected.size === suggestions.length;

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(suggestions.map(s => s.id)));
    }
  }, [allSelected, suggestions]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  const toggleSwap = useCallback((id: string) => {
    setSwapped(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSingleMerge = useCallback(async (suggestion: DedupeSuggestion) => {
    const isSwap = swapped.has(suggestion.id);
    const primaryId = isSwap ? suggestion.contactB.id : suggestion.contactA.id;
    const duplicateId = isSwap ? suggestion.contactA.id : suggestion.contactB.id;
    try {
      await mergeContacts.mutateAsync({ primaryId, duplicateId });
      onRemoveSuggestion(suggestion.id);
      toast.success(`Merged successfully`);
    } catch (err: any) {
      toast.error(`Merge failed: ${err.message}`);
    }
  }, [mergeContacts, swapped, onRemoveSuggestion]);

  const handleBulkMerge = useCallback(async () => {
    const merges = suggestions
      .filter(s => selected.has(s.id))
      .map(s => {
        const isSwap = swapped.has(s.id);
        return {
          primaryId: isSwap ? s.contactB.id : s.contactA.id,
          duplicateId: isSwap ? s.contactA.id : s.contactB.id,
        };
      });

    if (merges.length === 0) return;

    try {
      const result = await mergeBatch.mutateAsync(merges);
      // Remove successfully merged suggestions
      const successPairs = new Set(
        result.results.filter(r => r.success).map(r => `${[r.primaryId, r.duplicateId].sort().join('::')}`)
      );
      for (const s of suggestions) {
        if (selected.has(s.id) && successPairs.has(s.id)) {
          onRemoveSuggestion(s.id);
        }
      }
      setSelected(new Set());
      toast.success(`Merged ${result.succeeded} of ${result.total} pairs`);
      if (result.succeeded < result.total) {
        toast.error(`${result.total - result.succeeded} merge(s) failed`);
      }
    } catch (err: any) {
      toast.error(`Batch merge failed: ${err.message}`);
    }
  }, [suggestions, selected, swapped, mergeBatch, onRemoveSuggestion]);

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
        <h3 className="text-lg font-headline font-bold mb-2">All clean!</h3>
        <p className="text-sm text-on-surface-variant">No duplicate suggestions remaining.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSelectAll}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all",
              allSelected
                ? "bg-primary/15 text-primary"
                : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
            )}
          >
            <div className={cn(
              "w-4 h-4 rounded flex items-center justify-center transition-all",
              allSelected ? "bg-primary text-white" : "bg-surface-container-high"
            )}>
              {allSelected && <CheckCircle2 className="w-3 h-3" />}
            </div>
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-xs text-on-surface-variant">
            {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
            {selected.size > 0 && (
              <span className="ml-1 text-primary font-bold">· {selected.size} selected</span>
            )}
          </span>
        </div>

        {selected.size > 0 && (
          <button
            onClick={handleBulkMerge}
            disabled={mergeBatch.isPending}
            className="flex items-center gap-2 px-5 py-2 signature-gradient text-white rounded-full text-sm font-bold hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
          >
            {mergeBatch.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MergeIcon className="w-4 h-4" />
            )}
            Merge {selected.size} Selected
          </button>
        )}
      </div>

      {/* Suggestion rows */}
      <div className="flex-1 overflow-y-auto space-y-2 nice-scrollbar pr-1">
        {suggestions.map((suggestion, i) => {
          const isSelected = selected.has(suggestion.id);
          const isExpanded = expanded === suggestion.id;
          const isSwap = swapped.has(suggestion.id);
          const primary = isSwap ? suggestion.contactB : suggestion.contactA;
          const duplicate = isSwap ? suggestion.contactA : suggestion.contactB;

          return (
            <motion.div
              key={suggestion.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
            >
              <div className={cn(
                "bg-surface-container-lowest rounded-2xl shadow-sm transition-all",
                isSelected && "ring-2 ring-primary/40"
              )}>
                {/* Summary row */}
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer group"
                  onClick={() => toggleExpand(suggestion.id)}
                >
                  {/* Checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(suggestion.id); }}
                    className={cn(
                      "w-5 h-5 rounded flex items-center justify-center shrink-0 transition-all",
                      isSelected ? "bg-primary text-white" : "bg-surface-container-high group-hover:bg-surface-container-highest"
                    )}
                  >
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>

                  {/* Contact A */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <img
                      src={primary.avatarUrl || fallbackAvatarUrl(primary.name)}
                      alt={primary.name}
                      className="w-8 h-8 rounded-full object-cover bg-surface-container-high shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{primary.name}</div>
                      {primary.company && (
                        <div className="text-[11px] text-on-surface-variant truncate">{primary.company}</div>
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  <span className="text-on-surface-variant/30 shrink-0 text-xs">⇄</span>

                  {/* Contact B */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <img
                      src={duplicate.avatarUrl || fallbackAvatarUrl(duplicate.name)}
                      alt={duplicate.name}
                      className="w-8 h-8 rounded-full object-cover bg-surface-container-high shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{duplicate.name}</div>
                      {duplicate.company && (
                        <div className="text-[11px] text-on-surface-variant truncate">{duplicate.company}</div>
                      )}
                    </div>
                  </div>

                  {/* Match badge */}
                  <div className="shrink-0 hidden sm:block">
                    <MatchBadge type={suggestion.matchType} confidence={suggestion.confidence} />
                  </div>

                  {/* Individual merge button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSingleMerge(suggestion); }}
                    disabled={mergeContacts.isPending}
                    className="shrink-0 px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/15 rounded-full transition-colors disabled:opacity-50"
                  >
                    Merge
                  </button>

                  {/* Expand chevron */}
                  <div className="shrink-0 text-on-surface-variant/40">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-4">
                        {/* Reasoning */}
                        <div className="bg-surface-container-low rounded-xl p-3 text-sm text-on-surface leading-relaxed">
                          {suggestion.reasoning}
                        </div>

                        {/* Side-by-side cards */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 relative">
                          <ContactCard
                            contact={primary}
                            label="Primary (Keeper)"
                            labelColor="text-emerald-600 bg-emerald-500/10"
                            other={duplicate}
                          />

                          {/* Swap button */}
                          <button
                            onClick={() => toggleSwap(suggestion.id)}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 p-2 bg-surface-container-lowest rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all hidden lg:flex items-center justify-center"
                            title="Swap primary / duplicate"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5 text-on-surface-variant hover:text-primary transition-colors" />
                          </button>

                          <ContactCard
                            contact={duplicate}
                            label="Duplicate (Merges In)"
                            labelColor="text-amber-600 bg-amber-500/10"
                            other={primary}
                          />
                        </div>

                        {/* Mobile swap */}
                        <button
                          onClick={() => toggleSwap(suggestion.id)}
                          className="lg:hidden w-full flex items-center justify-center gap-2 py-2 bg-surface-container-low rounded-xl text-xs font-bold text-on-surface-variant hover:text-primary transition-colors"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                          Swap Primary / Duplicate
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
