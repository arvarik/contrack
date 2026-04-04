import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Sparkles, Zap, Shield, ChevronLeft,
  ChevronRight, AlertCircle, Loader2, ScanSearch,
  Brain, Undo2, Merge, Users, HandMetal,
} from 'lucide-react';
import { useDedupeSuggestions, useMergeContacts } from '../api';
import type { DedupeSuggestion } from '../types';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  ICON_BTN, PAGE_TITLE, SECTION_HEADING,
  EMPTY_HERO, TAB_CONTAINER, tabItem,
} from '../lib/styles';
import { cn } from '../lib/utils';
import { SwipeCard } from '../components/dedupe/SwipeCard';
import { EngineInfoCard } from '../components/dedupe/ContactCompare';
import { ManualMerge } from '../components/dedupe/ManualMerge';

// =============================================================================
// CleanupView — The Singularity De-Duplication Engine
// =============================================================================

type DedupeTab = 'auto' | 'manual';

export const CleanupView = ({ embedded = false }: { embedded?: boolean }) => {
  const [activeTab, setActiveTab] = useState<DedupeTab>('auto');
  const [scanStarted, setScanStarted] = useState(false);
  const { data: suggestions, isLoading, error, refetch } = useDedupeSuggestions(scanStarted);
  const mergeContacts = useMergeContacts();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set());
  const [dismissHistory, setDismissHistory] = useState<string[]>([]);

  // Filter out dismissed and already-merged suggestions
  const activeSuggestions = useMemo(() => {
    return (suggestions ?? []).filter(s => !dismissed.has(s.id) && !mergedIds.has(s.id));
  }, [suggestions, dismissed, mergedIds]);

  const currentSuggestion = activeSuggestions[currentIndex] ?? null;
  const nextSuggestion = activeSuggestions[currentIndex + 1] ?? null;
  const totalActive = activeSuggestions.length;
  const totalProcessed = dismissed.size + mergedIds.size;

  // Clamp index when list shrinks
  useEffect(() => {
    if (currentIndex >= totalActive && totalActive > 0) {
      setCurrentIndex(totalActive - 1);
    }
  }, [totalActive, currentIndex]);

  // Handle dismiss (keep separate)
  const handleDismiss = useCallback(() => {
    if (!currentSuggestion) return;
    setDismissed(prev => new Set(prev).add(currentSuggestion.id));
    setDismissHistory(prev => [...prev, currentSuggestion.id]);
    toast('Kept separate', { icon: <Shield className="w-4 h-4 text-on-surface-variant" /> });
  }, [currentSuggestion]);

  // Handle undo dismiss
  const handleUndoDismiss = useCallback(() => {
    if (dismissHistory.length === 0) return;
    const lastId = dismissHistory[dismissHistory.length - 1];
    setDismissHistory(prev => prev.slice(0, -1));
    setDismissed(prev => {
      const next = new Set(prev);
      next.delete(lastId);
      return next;
    });
    toast('Restored', { icon: <Undo2 className="w-4 h-4 text-primary" /> });
  }, [dismissHistory]);

  // Handle merge
  const handleMerge = useCallback(async (primaryId: string, duplicateId: string) => {
    if (!currentSuggestion || mergeContacts.isPending) return;
    try {
      await mergeContacts.mutateAsync({ primaryId, duplicateId });
      setMergedIds(prev => new Set(prev).add(currentSuggestion.id));
      toast.success(`Merged successfully`);
    } catch (err: any) {
      toast.error(`Merge failed: ${err.message}`);
    }
  }, [currentSuggestion, mergeContacts]);

  // Navigate between suggestions
  const goNext = useCallback(() => {
    if (currentIndex < totalActive - 1) setCurrentIndex(i => i + 1);
  }, [currentIndex, totalActive]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(i => i - 1);
  }, [currentIndex]);

  // Keyboard shortcuts (only active on auto tab)
  useEffect(() => {
    if (activeTab !== 'auto') return;
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'h':
          e.preventDefault();
          handleDismiss();
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          if (currentSuggestion) {
            handleMerge(currentSuggestion.contactA.id, currentSuggestion.contactB.id);
          }
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          goPrev();
          break;
        case 'z':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleUndoDismiss();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, handleDismiss, handleMerge, handleUndoDismiss, goNext, goPrev, currentSuggestion]);

  // Start scan
  const startScan = () => {
    setScanStarted(true);
    setCurrentIndex(0);
    setDismissed(new Set());
    setMergedIds(new Set());
    setDismissHistory([]);
  };

  const resetScan = () => {
    refetch();
    setCurrentIndex(0);
    setDismissed(new Set());
    setMergedIds(new Set());
    setDismissHistory([]);
  };

  return (
    <div className={cn("flex flex-col overflow-hidden bg-surface", embedded ? "h-full" : "h-full")}>
      {/* Tab Bar */}
      <div className="shrink-0 p-4 pb-0 bg-surface">
        <div className={cn(TAB_CONTAINER, "w-fit")}>
          <button
            onClick={() => setActiveTab('auto')}
            className={cn(tabItem(activeTab === 'auto'), "flex items-center gap-2")}
          >
            <Zap className="w-4 h-4" />
            Auto Scan
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={cn(tabItem(activeTab === 'manual'), "flex items-center gap-2")}
          >
            <HandMetal className="w-4 h-4" />
            Manual Merge
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'auto' ? (
          <motion.div
            key="auto"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex-1 flex flex-col overflow-hidden min-h-0"
          >
            {/* Auto scan header bar */}
            {scanStarted && !isLoading && totalActive > 0 && (
              <div className="shrink-0 px-6 pt-4">
                {/* Stats bar */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-on-surface">
                      {currentIndex + 1} of {totalActive}
                    </span>
                    {totalProcessed > 0 && (
                      <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                        {mergedIds.size > 0 && (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {mergedIds.size} merged
                          </span>
                        )}
                        {dismissed.size > 0 && (
                          <span className="flex items-center gap-1">
                            <Shield className="w-3.5 h-3.5" />
                            {dismissed.size} skipped
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {dismissHistory.length > 0 && (
                      <button
                        onClick={handleUndoDismiss}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-on-surface-variant hover:text-primary bg-surface-container-low hover:bg-primary/10 rounded-full transition-all"
                        title="Undo last dismiss (⌘Z)"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        Undo
                      </button>
                    )}
                    <button
                      onClick={goPrev}
                      disabled={currentIndex === 0}
                      className="p-1.5 rounded-lg hover:bg-surface-container-high disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={goNext}
                      disabled={currentIndex >= totalActive - 1}
                      className="p-1.5 rounded-lg hover:bg-surface-container-high disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={resetScan}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/15 rounded-full transition-colors ml-1"
                    >
                      <ScanSearch className="w-3.5 h-3.5" />
                      Re-Scan
                    </button>
                  </div>
                </div>

                {/* Progress track */}
                <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                  <motion.div
                    className="h-full signature-gradient rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentIndex + 1) / totalActive) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                </div>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Pre-scan state */}
              {!scanStarted && (
                <div className={EMPTY_HERO}>
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="p-6 bg-primary/8 rounded-3xl mb-6"
                  >
                    <Brain className="w-16 h-16 text-primary" />
                  </motion.div>
                  <h2 className="text-xl font-headline font-bold mb-3">Ready to clean your network</h2>
                  <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
                    The Singularity scans your contacts for duplicates using a two-pass engine:
                    exact email & phone matching, then AI-powered fuzzy name analysis.
                  </p>
                  <div className="grid grid-cols-2 gap-3 w-full text-left mb-8">
                    <EngineInfoCard
                      icon={<Shield className="w-5 h-5 text-emerald-500" />}
                      title="Pass 1: Deterministic"
                      desc="Exact email & phone matches"
                    />
                    <EngineInfoCard
                      icon={<Sparkles className="w-5 h-5 text-primary" />}
                      title="Pass 2: AI Analysis"
                      desc="Fuzzy names via Gemini"
                    />
                  </div>
                  <button
                    onClick={startScan}
                    className="btn-primary flex items-center gap-2 px-8 py-3"
                  >
                    <ScanSearch className="w-5 h-5" />
                    Begin Scan
                  </button>
                </div>
              )}

              {/* Loading */}
              {scanStarted && isLoading && (
                <div className="flex flex-col items-center justify-center h-full">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  >
                    <Loader2 className="w-12 h-12 text-primary mb-4" />
                  </motion.div>
                  <p className="text-on-surface-variant font-bold">Scanning contacts for duplicates...</p>
                  <p className="text-xs text-on-surface-variant/70 mt-1">This may take a moment if AI analysis is enabled</p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex flex-col items-center justify-center h-full">
                  <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
                  <p className="text-rose-500 font-bold">Scan failed</p>
                  <p className="text-sm text-on-surface-variant mt-1">{(error as Error).message}</p>
                  <button onClick={resetScan} className="mt-4 btn-secondary">
                    Try Again
                  </button>
                </div>
              )}

              {/* All clean */}
              {scanStarted && !isLoading && !error && totalActive === 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center h-full text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
                    className="p-6 bg-emerald-500/10 rounded-3xl mb-6"
                  >
                    <CheckCircle2 className="w-16 h-16 text-emerald-500" />
                  </motion.div>
                  <h2 className="text-xl font-headline font-bold mb-2">All clean!</h2>
                  <p className="text-on-surface-variant text-sm mb-2">
                    {mergedIds.size > 0
                      ? `Merged ${mergedIds.size} duplicate${mergedIds.size > 1 ? 's' : ''}. Your network is pristine.`
                      : 'No duplicate contacts detected. Your network is pristine.'}
                  </p>
                  {dismissed.size > 0 && (
                    <p className="text-xs text-on-surface-variant/60 mb-4">
                      ({dismissed.size} pair{dismissed.size > 1 ? 's' : ''} kept separate)
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={resetScan}
                      className="px-6 py-2.5 bg-primary/10 text-primary font-bold rounded-full hover:bg-primary/15 transition-colors text-sm"
                    >
                      Scan Again
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Active suggestion — SwipeCard */}
              {scanStarted && !isLoading && currentSuggestion && (
                <div className="max-w-5xl mx-auto">
                  <AnimatePresence mode="wait">
                    <SwipeCard
                      key={currentSuggestion.id}
                      suggestion={currentSuggestion}
                      onMerge={handleMerge}
                      onDismiss={handleDismiss}
                      isMerging={mergeContacts.isPending}
                      nextSuggestion={nextSuggestion}
                    />
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="manual"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="flex-1 overflow-hidden p-6 min-h-0"
          >
            <ManualMerge />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
