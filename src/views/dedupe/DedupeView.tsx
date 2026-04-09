import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isTypingTarget } from '../../lib/keyboard';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Sparkles, Zap, Shield, ChevronLeft,
  ChevronRight, AlertCircle, Loader2, ScanSearch,
  Brain, Undo2, HandMetal, List, Layers,
  Database, Cpu, GitMerge,
} from 'lucide-react';
import { useMergeCluster } from '../../api';
import type { DedupeScanMode, DedupeCluster } from '../../types';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  EMPTY_HERO, TAB_CONTAINER, tabItem,
} from '../../lib/styles';
import { cn } from '../../lib/utils';
import { ClusterSwipeCard, ClusterList, ManualMerge } from './components';
import { useDedupe } from '../../contexts/DedupeContext';

// =============================================================================
// DedupeView — The Singularity De-Duplication Engine (Cluster-Based)
// =============================================================================

type DedupeTab = 'auto' | 'manual';
type ResultView = 'swipe' | 'list';

export const DedupeView = ({ embedded = false }: { embedded?: boolean }) => {
  const [activeTab, setActiveTab] = useState<DedupeTab>('auto');
  const [resultView, setResultView] = useState<ResultView>('swipe');
  const [selectedMode, setSelectedMode] = useState<DedupeScanMode>('both');

  const { scan, clusters, isScanning, isStarting, startScan, reset, removeCluster } = useDedupe();
  const mergeCluster = useMergeCluster();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set());
  const [dismissHistory, setDismissHistory] = useState<string[]>([]);

  // Filter out dismissed and already-merged clusters for swipe view
  const activeClusters = useMemo(() => {
    return clusters.filter(c => !dismissed.has(c.id) && !mergedIds.has(c.id));
  }, [clusters, dismissed, mergedIds]);

  const currentCluster = activeClusters[currentIndex] ?? null;
  const totalActive = activeClusters.length;
  const totalProcessed = dismissed.size + mergedIds.size;

  // Determine the current phase of the UI
  const scanComplete = scan?.phase === 'complete';
  const scanError = scan?.phase === 'error';
  const hasResults = scanComplete && clusters.length > 0;
  const preScan = !scan && !isStarting;

  // Clamp index when list shrinks
  useEffect(() => {
    if (currentIndex >= totalActive && totalActive > 0) {
      setCurrentIndex(totalActive - 1);
    }
  }, [totalActive, currentIndex]);

  // Reset local state when a new scan starts
  useEffect(() => {
    if (isScanning) {
      setCurrentIndex(0);
      setDismissed(new Set());
      setMergedIds(new Set());
      setDismissHistory([]);
    }
  }, [isScanning]);

  // Handle dismiss (keep separate)
  const handleDismiss = useCallback(() => {
    if (!currentCluster) return;
    setDismissed(prev => new Set(prev).add(currentCluster.id));
    setDismissHistory(prev => [...prev, currentCluster.id]);
    toast('Kept separate', { icon: <Shield className="w-4 h-4 text-on-surface-variant" /> });
  }, [currentCluster]);

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

  // Handle cluster merge
  const handleClusterMerge = useCallback(async (primaryId: string, duplicateIds: string[]) => {
    if (!currentCluster || mergeCluster.isPending) return;
    try {
      await mergeCluster.mutateAsync({ primaryId, duplicateIds });
      setMergedIds(prev => new Set(prev).add(currentCluster.id));
      removeCluster(currentCluster.id);
      toast.success(`Merged ${duplicateIds.length + 1} contacts into one`);
    } catch (err: any) {
      toast.error(`Merge failed: ${err.message}`);
    }
  }, [currentCluster, mergeCluster, removeCluster]);

  // Navigate between clusters
  const goNext = useCallback(() => {
    if (currentIndex < totalActive - 1) setCurrentIndex(i => i + 1);
  }, [currentIndex, totalActive]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(i => i - 1);
  }, [currentIndex]);

  // Keyboard shortcuts (only active on auto tab, swipe view)
  useEffect(() => {
    if (activeTab !== 'auto' || resultView !== 'swipe' || !hasResults) return;
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'h':
          e.preventDefault();
          handleDismiss();
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          if (currentCluster) {
            const primaryId = currentCluster.suggestedPrimaryId;
            const duplicateIds = currentCluster.contacts
              .filter(c => c.id !== primaryId)
              .map(c => c.id);
            handleClusterMerge(primaryId, duplicateIds);
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
  }, [activeTab, resultView, hasResults, handleDismiss, handleClusterMerge, handleUndoDismiss, goNext, goPrev, currentCluster]);

  // Start scan handler
  const handleStartScan = () => {
    startScan(selectedMode);
  };

  const handleNewScan = () => {
    reset();
    setCurrentIndex(0);
    setDismissed(new Set());
    setMergedIds(new Set());
    setDismissHistory([]);
    setResultView('swipe');
  };

  // Scan mode options
  const scanModes: { mode: DedupeScanMode; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      mode: 'deterministic',
      icon: <Shield className="w-5 h-5 text-emerald-500" />,
      title: 'Deterministic Only',
      desc: 'Exact email & phone matches. Fast, no AI needed.',
    },
    {
      mode: 'ai',
      icon: <Sparkles className="w-5 h-5 text-primary" />,
      title: 'AI Only',
      desc: 'Fuzzy name analysis via Gemini.',
    },
    {
      mode: 'both',
      icon: <Zap className="w-5 h-5 text-amber-500" />,
      title: 'Both (Recommended)',
      desc: 'Two-pass scan: exact matches first, then AI analysis.',
    },
  ];

  return (
    <div className={cn("flex flex-col overflow-hidden bg-surface", embedded ? "h-full" : "h-full")}>
      {/* Tab Bar */}
      <div className="shrink-0 p-4 pb-0 bg-surface flex items-center gap-3">
        {embedded && (
          <Link
            to="/settings"
            className="p-2 rounded-xl text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
            title="Back to Settings"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
        )}
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
            {/* Results header (swipe view) */}
            {hasResults && resultView === 'swipe' && totalActive > 0 && (
              <div className="shrink-0 px-6 pt-4">
                {/* Stats bar */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-on-surface">
                      {totalProcessed + currentIndex + 1} of {clusters.length}
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
                  </div>
                </div>

                {/* Progress track */}
                <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                  <motion.div
                    className="h-full signature-gradient rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${((totalProcessed + currentIndex + 1) / clusters.length) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                </div>
              </div>
            )}

            {/* Results view switcher */}
            {hasResults && (
              <div className="shrink-0 px-6 pt-3 flex items-center justify-between">
                <div className={cn(TAB_CONTAINER, "w-fit")}>
                  <button
                    onClick={() => setResultView('swipe')}
                    className={cn(tabItem(resultView === 'swipe'), "flex items-center gap-1.5 text-xs")}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Swipe
                  </button>
                  <button
                    onClick={() => setResultView('list')}
                    className={cn(tabItem(resultView === 'list'), "flex items-center gap-1.5 text-xs")}
                  >
                    <List className="w-3.5 h-3.5" />
                    List
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleNewScan}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/15 rounded-full transition-colors"
                  >
                    <ScanSearch className="w-3.5 h-3.5" />
                    New Scan
                  </button>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 pb-24 lg:pb-6">
              {/* ═══ Phase 1: Pre-scan — mode selector ═══ */}
              {preScan && (
                <div className={EMPTY_HERO}>
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="p-6 bg-primary/8 rounded-3xl mb-6"
                  >
                    <Brain className="w-16 h-16 text-primary" />
                  </motion.div>
                  <h2 className="text-xl font-headline font-bold mb-3">Network Dedupe Engine</h2>
                  <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
                    Clean your network by merging duplicate contacts
                  </p>

                  {/* Scan mode selector */}
                  <div className="w-full space-y-2 mb-8">
                    {scanModes.map(({ mode, icon, title, desc }) => (
                      <button
                        key={mode}
                        onClick={() => setSelectedMode(mode)}
                        className={cn(
                          "w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all",
                          selectedMode === mode
                            ? "bg-primary/8 ring-2 ring-primary/40 shadow-sm"
                            : "bg-surface-container-lowest shadow-sm hover:bg-surface-container-low"
                        )}
                      >
                        <div className={cn(
                          "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                          selectedMode === mode ? "bg-primary/15" : "bg-surface-container-low"
                        )}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-on-surface">{title}</div>
                          <div className="text-xs text-on-surface-variant">{desc}</div>
                        </div>
                        <div className={cn(
                          "w-5 h-5 rounded-full shrink-0 flex items-center justify-center transition-all",
                          selectedMode === mode
                            ? "bg-primary"
                            : "bg-surface-container-high"
                        )}>
                          {selectedMode === mode && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="w-2 h-2 bg-white rounded-full"
                            />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleStartScan}
                    disabled={isStarting}
                    className="btn-primary flex items-center gap-2 px-8 py-3 disabled:opacity-50"
                  >
                    {isStarting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <ScanSearch className="w-5 h-5" />
                    )}
                    Begin Scan
                  </button>
                </div>
              )}

              {/* ═══ Phase 2: Scanning — progress card ═══ */}
              {isScanning && scan && (
                <div className="flex flex-col items-center justify-center h-full">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md"
                  >
                    <div className="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden">
                      {/* Header */}
                      <div className="px-5 py-4 bg-surface-container-low flex items-center gap-3">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                        >
                          <Cpu className="w-5 h-5 text-primary" />
                        </motion.div>
                        <div className="flex-1">
                          <div className="text-sm font-bold text-on-surface">Dedupe Scan</div>
                          <div className="text-[11px] text-on-surface-variant capitalize">{scan.mode} mode</div>
                        </div>
                        <span className="text-xs text-on-surface-variant tabular-nums">
                          {scan.contactsScanned}/{scan.totalContacts || '…'}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="h-1.5 bg-surface-container-high">
                        <motion.div
                          className="h-full bg-gradient-to-r from-primary-dim to-primary-container"
                          animate={{
                            width: scan.totalContacts > 0
                              ? `${(scan.contactsScanned / scan.totalContacts) * 100}%`
                              : '0%',
                          }}
                          transition={{ duration: 0.4, ease: 'easeOut' }}
                        />
                      </div>

                      {/* Phase details */}
                      <div className="p-5 space-y-4">
                        {/* Current phase */}
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                          <span className="text-sm text-on-surface font-medium">
                            {scan.phaseName}
                          </span>
                        </div>

                        {/* Phase pipeline */}
                        <div className="space-y-2">
                          {(scan.mode === 'deterministic' || scan.mode === 'both') && (
                            <PhaseRow
                              icon={<Shield className="w-3.5 h-3.5" />}
                              label="Deterministic Pass"
                              status={
                                scan.phase === 'starting' ? 'pending' :
                                scan.phase === 'deterministic' ? 'active' : 'done'
                              }
                              detail={scan.deterministicFound > 0 ? `${scan.deterministicFound} found` : undefined}
                            />
                          )}
                          {(scan.mode === 'ai' || scan.mode === 'both') && (
                            <PhaseRow
                              icon={<Sparkles className="w-3.5 h-3.5" />}
                              label="AI Analysis"
                              status={
                                scan.phase === 'starting' || scan.phase === 'deterministic' ? 'pending' :
                                scan.phase === 'ai' ? 'active' : 'done'
                              }
                              detail={scan.aiCandidatesFound > 0 ? `${scan.aiCandidatesFound} found` : undefined}
                            />
                          )}
                          <PhaseRow
                            icon={<GitMerge className="w-3.5 h-3.5" />}
                            label="Cluster Grouping"
                            status={
                              scan.phase === 'clustering' ? 'active' :
                              scan.phase === 'complete' ? 'done' : 'pending'
                            }
                            detail={scan.clustersFound > 0 ? `${scan.clustersFound} cluster${scan.clustersFound !== 1 ? 's' : ''}` : undefined}
                          />
                        </div>

                        {/* Findings so far */}
                        {(scan.deterministicFound > 0 || scan.aiCandidatesFound > 0) && (
                          <div className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl px-3 py-2 flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-primary" />
                            <span>
                              <span className="font-bold text-on-surface">
                                {scan.deterministicFound + scan.aiCandidatesFound}
                              </span>
                              {' '}potential pair{scan.deterministicFound + scan.aiCandidatesFound !== 1 ? 's' : ''} found so far
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Help text */}
                    <p className="text-xs text-on-surface-variant/60 text-center mt-4">
                      You can navigate away — the scan will continue in the background
                    </p>
                  </motion.div>
                </div>
              )}

              {/* ═══ Phase 3: Scan error ═══ */}
              {scanError && scan && (
                <div className="flex flex-col items-center justify-center h-full">
                  <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
                  <p className="text-rose-500 font-bold">Scan failed</p>
                  <p className="text-sm text-on-surface-variant mt-1">{scan.error}</p>
                  <button onClick={handleNewScan} className="mt-4 btn-secondary">
                    Try Again
                  </button>
                </div>
              )}

              {/* ═══ Phase 3: All clean (no results) ═══ */}
              {scanComplete && clusters.length === 0 && (
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
                  <p className="text-on-surface-variant text-sm mb-4">
                    No duplicate contacts detected. Your network is pristine.
                  </p>
                  <button
                    onClick={handleNewScan}
                    className="px-6 py-2.5 bg-primary/10 text-primary font-bold rounded-full hover:bg-primary/15 transition-colors text-sm"
                  >
                    Scan Again
                  </button>
                </motion.div>
              )}

              {/* ═══ Phase 3: Results — Swipe view ═══ */}
              {hasResults && resultView === 'swipe' && (
                <>
                  {/* All processed in swipe view */}
                  {totalActive === 0 && (
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
                      <h2 className="text-xl font-headline font-bold mb-2">All reviewed!</h2>
                      <p className="text-on-surface-variant text-sm mb-2">
                        {mergedIds.size > 0
                          ? `Merged ${mergedIds.size} cluster${mergedIds.size > 1 ? 's' : ''}. Your network is pristine.`
                          : 'All clusters have been reviewed.'}
                      </p>
                      {dismissed.size > 0 && (
                        <p className="text-xs text-on-surface-variant/60 mb-4">
                          ({dismissed.size} cluster{dismissed.size > 1 ? 's' : ''} kept separate)
                        </p>
                      )}



                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleNewScan}
                          className="px-6 py-2.5 bg-primary/10 text-primary font-bold rounded-full hover:bg-primary/15 transition-colors text-sm"
                        >
                          New Scan
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* Active swipe card */}
                  {currentCluster && (
                    <div className="max-w-5xl mx-auto">
                      <AnimatePresence mode="wait">
                        <ClusterSwipeCard
                          key={currentCluster.id}
                          cluster={currentCluster}
                          onMerge={handleClusterMerge}
                          onDismiss={handleDismiss}
                          isMerging={mergeCluster.isPending}
                          hasNext={currentIndex < totalActive - 1}
                        />
                      </AnimatePresence>
                    </div>
                  )}
                </>
              )}

              {/* ═══ Phase 3: Results — List view ═══ */}
              {hasResults && resultView === 'list' && (
                <ClusterList
                  clusters={clusters}
                  onRemoveCluster={removeCluster}
                />
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

// =============================================================================
// PhaseRow — Individual phase step in the progress card
// =============================================================================

function PhaseRow({
  icon,
  label,
  status,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  status: 'pending' | 'active' | 'done';
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className={cn(
        "shrink-0 transition-colors",
        status === 'done' ? 'text-emerald-500' :
        status === 'active' ? 'text-primary' :
        'text-on-surface-variant/30'
      )}>
        {status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
         status === 'active' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
         icon}
      </div>
      <span className={cn(
        "flex-1",
        status === 'done' ? 'text-on-surface' :
        status === 'active' ? 'text-on-surface font-medium' :
        'text-on-surface-variant/40'
      )}>
        {label}
      </span>
      {detail && (
        <span className={cn(
          "text-xs tabular-nums",
          status === 'done' ? 'text-emerald-500' : 'text-primary'
        )}>
          {detail}
        </span>
      )}
    </div>
  );
}
