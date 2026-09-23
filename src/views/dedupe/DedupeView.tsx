import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isTypingTarget } from "../../lib/keyboard";
import {
  CheckCircle2,
  Sparkles,
  Zap,
  Shield,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  ScanSearch,
  Brain,
  Undo2,
  List,
  Layers,
  Database,
  Cpu,
  GitMerge,
  History,
  Hourglass,
  X,
} from "lucide-react";
import { useMergeCluster } from "../../api";
import type { DedupeScanMode } from "../../types";
import { MODE_NAME, runsAiPass, stepStatus } from "./utils/scanPhases";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  CARD,
  CARD_INTERACTIVE,
  EMPTY_HERO,
  ICON_BTN,
  PAGE_X,
  SELECTED_ROW,
  TAB_CONTAINER,
  TONE_WASH,
  tabItem,
} from "../../lib/styles";
import { DURATION, EASE } from "../../lib/motion";
import { cn } from "../../lib/utils";
import {
  ClusterSwipeCard,
  ClusterList,
  ManualMerge,
  ActivityFeed,
} from "./components";
import { useDedupe } from "../../contexts/DedupeContext";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";
import { NAMES } from "../../lib/names";
import { EmptyState } from "../../components/ui/EmptyState";
import { CorvidMark } from "../../components/brand/CorvidMark";
import { Segmented } from "../../components/ui/Segmented";
import { RadioDot } from "../../components/ui/RadioDot";

// =============================================================================
// DedupeView — The Singularity De-Duplication Engine (Cluster-Based)
// =============================================================================

type DedupeTab = "auto" | "manual";
type ResultView = "swipe" | "list";

/** "Merge activity": a quiet button that opens the activity panel. */
const ACTIVITY_BUTTON =
  "hit-area state-layer hidden sm:flex items-center gap-2 px-3 py-2 text-xs font-bold text-on-surface-variant bg-surface-container-low rounded-xl transition-colors shrink-0";

/** The previous and next arrows over the swipe card. */
const STEP_BUTTON =
  "hit-area state-layer p-1.5 rounded-lg transition-colors disabled:text-on-surface-variant disabled:cursor-not-allowed";

/**
 * The Duplicates page's body. It always renders inside the Settings shell,
 * which draws the page's header and, below `sm`, its Merge activity menu.
 * The page sets its width (`DuplicatesPage`'s column) and each row here adds
 * the gutters, so the content fills that column and shares the settings
 * card's left edge. A narrower cap here would start it off that edge.
 */
export const DedupeView = () => {
  const [activeTab, setActiveTab] = useState<DedupeTab>("auto");
  const [resultView, setResultView] = useState<ResultView>("swipe");
  const [selectedMode, setSelectedMode] = useState<DedupeScanMode>("deep");

  const {
    scan,
    clusters,
    isScanning,
    isStarting,
    startScan,
    reset,
    removeCluster,
    isQueued,
    showActivity,
    setShowActivity,
  } = useDedupe();
  const mergeCluster = useMergeCluster();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set());
  const [dismissHistory, setDismissHistory] = useState<string[]>([]);

  // Filter out dismissed and already-merged clusters for swipe view
  const activeClusters = useMemo(() => {
    return clusters.filter((c) => !dismissed.has(c.id) && !mergedIds.has(c.id));
  }, [clusters, dismissed, mergedIds]);

  const currentCluster = activeClusters[currentIndex] ?? null;
  const totalActive = activeClusters.length;
  const totalProcessed = dismissed.size + mergedIds.size;

  // Determine the current phase of the UI
  const scanComplete = scan?.phase === "complete";
  const scanError = scan?.phase === "error";
  const hasResults = scanComplete && clusters.length > 0;
  // The pre-scan page is what you see when nothing is happening. Three things
  // count as something happening, and the last two hold no scan record:
  // `isStarting` is the request in flight, and `isQueued` is a turn booked
  // behind another account. Without them the page flashes empty between the
  // click and the first server answer.
  const preScan = !scan && !isStarting && !isQueued;

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
    setDismissed((prev) => new Set(prev).add(currentCluster.id));
    setDismissHistory((prev) => [...prev, currentCluster.id]);
    toast("Kept separate", {
      icon: <Shield className="w-4 h-4 text-on-surface-variant" />,
    });
  }, [currentCluster]);

  // Handle undo dismiss
  const handleUndoDismiss = useCallback(() => {
    if (dismissHistory.length === 0) return;
    const lastId = dismissHistory[dismissHistory.length - 1];
    setDismissHistory((prev) => prev.slice(0, -1));
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(lastId);
      return next;
    });
    toast("Restored", { icon: <Undo2 className="w-4 h-4 text-primary" /> });
  }, [dismissHistory]);

  // Handle cluster merge
  const handleClusterMerge = useCallback(
    async (primaryId: string, duplicateIds: string[]) => {
      if (!currentCluster || mergeCluster.isPending) return;
      try {
        await mergeCluster.mutateAsync({ primaryId, duplicateIds });
        setMergedIds((prev) => new Set(prev).add(currentCluster.id));
        removeCluster(currentCluster.id);
        toast.success(`Merged ${duplicateIds.length + 1} contacts into one`);
      } catch (err: unknown) {
        toast.error(
          `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [currentCluster, mergeCluster, removeCluster],
  );

  // Navigate between clusters
  const goNext = useCallback(() => {
    if (currentIndex < totalActive - 1) setCurrentIndex((i) => i + 1);
  }, [currentIndex, totalActive]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  }, [currentIndex]);

  const singleKeys = useSingleKeyShortcuts();

  // Keyboard shortcuts (only active on auto tab, swipe view)
  useEffect(() => {
    if (activeTab !== "auto" || resultView !== "swipe" || !hasResults) return;
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (
        !singleKeys &&
        (e.key === "h" || e.key === "l" || e.key === "j" || e.key === "k")
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
        case "h":
          e.preventDefault();
          handleDismiss();
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          if (currentCluster) {
            const primaryId = currentCluster.suggestedPrimaryId;
            const duplicateIds = currentCluster.contacts
              .filter((c) => c.id !== primaryId)
              .map((c) => c.id);
            handleClusterMerge(primaryId, duplicateIds);
          }
          break;
        case "ArrowDown":
        case "j":
          e.preventDefault();
          goNext();
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          goPrev();
          break;
        case "z":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleUndoDismiss();
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeTab,
    resultView,
    hasResults,
    handleDismiss,
    handleClusterMerge,
    handleUndoDismiss,
    goNext,
    goPrev,
    currentCluster,
    singleKeys,
  ]);

  // Start scan handler. The server reads the account's sensitivity preset
  // itself, the same way it does for an import, so nothing about the
  // threshold travels with the request.
  const handleStartScan = () => {
    startScan(selectedMode);
  };

  const handleNewScan = () => {
    reset();
    setCurrentIndex(0);
    setDismissed(new Set());
    setMergedIds(new Set());
    setDismissHistory([]);
    setResultView("swipe");
  };

  // Scan mode options
  const scanModes: {
    mode: DedupeScanMode;
    icon: React.ReactNode;
    title: string;
    desc: string;
  }[] = [
    {
      mode: "quick",
      icon: <Shield className="w-5 h-5 text-success" />,
      title: "Quick scan",
      desc: "Finds contacts with the same email, phone, or name.",
    },
    {
      mode: "deep",
      icon: <Sparkles className="w-5 h-5 text-primary" />,
      title: "Smart scan",
      desc: "Uses AI to catch duplicates that aren\u2019t obvious.",
    },
    {
      mode: "full",
      icon: <Zap className="w-5 h-5 text-warning" />,
      title: "Full scan",
      desc: "Reanalyzes your entire network from scratch.",
    },
  ];

  return (
    // The settings page is the one scroller at every width, so the tool
    // takes its own height and clips only sideways (for the tabs' slide).
    // A clip on both axes would stop a sticky control inside it, Compare in
    // the manual tab, from sticking to the screen.
    <div className="flex flex-col overflow-x-clip bg-surface">
      {/* Segmented Mode Selector */}
      <div className={cn("shrink-0 pt-4 bg-surface", PAGE_X)}>
        <div className="flex items-center justify-between gap-3">
          <Segmented
            label="Dedupe mode"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: "auto", label: "Auto scan" },
              { value: "manual", label: "Manual merge" },
            ]}
            className="w-full sm:w-auto"
          />

          {/*
            The Settings shell draws the header and puts Merge activity in
            its menu below sm. From sm up this button is the one control, so
            every width has one.
          */}
          <button
            type="button"
            onClick={() => setShowActivity(true)}
            className={ACTIVITY_BUTTON}
          >
            <History className="w-4 h-4" />
            Merge activity
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === "auto" ? (
          <motion.div
            key="auto"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex flex-col"
          >
            {/* Results header (swipe view) */}
            {hasResults && resultView === "swipe" && totalActive > 0 && (
              <div className={cn("shrink-0 pt-4", PAGE_X)}>
                {/* Stats bar */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-on-surface">
                      {totalProcessed + currentIndex + 1} of {clusters.length}
                    </span>
                    {totalProcessed > 0 && (
                      <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                        {mergedIds.size > 0 && (
                          <span className="flex items-center gap-1 text-success">
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
                        className="hit-area state-layer flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-on-surface-variant hover:text-on-surface bg-surface-container-low rounded-lg transition-colors"
                        title="Undo last dismiss (⌘Z)"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        Undo
                      </button>
                    )}
                    <button
                      onClick={goPrev}
                      disabled={currentIndex === 0}
                      aria-label="Previous group"
                      className={STEP_BUTTON}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={goNext}
                      disabled={currentIndex >= totalActive - 1}
                      aria-label="Next group"
                      className={STEP_BUTTON}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Progress track */}
                <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary rounded-full"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${((totalProcessed + currentIndex + 1) / clusters.length) * 100}%`,
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                </div>
              </div>
            )}

            {/* Results view switcher */}
            {hasResults && (
              <div
                className={cn(
                  "shrink-0 pt-3 flex items-center justify-between",
                  PAGE_X,
                )}
              >
                <div className={cn(TAB_CONTAINER, "w-fit")}>
                  <button
                    onClick={() => setResultView("swipe")}
                    className={cn(
                      tabItem(resultView === "swipe"),
                      "flex items-center gap-1.5 text-xs min-h-[44px] sm:min-h-0",
                    )}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Swipe
                  </button>
                  <button
                    onClick={() => setResultView("list")}
                    className={cn(
                      tabItem(resultView === "list"),
                      "flex items-center gap-1.5 text-xs min-h-[44px] sm:min-h-0",
                    )}
                  >
                    <List className="w-3.5 h-3.5" />
                    List
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleNewScan}
                    className="btn-secondary btn-sm"
                  >
                    <ScanSearch className="w-3.5 h-3.5" />
                    New scan
                  </button>
                </div>
              </div>
            )}

            {/* Body. The page scrolls it. The bottom padding clears the
                phone tab bar below md. */}
            <div className={cn("pt-6 pb-24 md:pb-6", PAGE_X)}>
              {/* ═══ Phase 1: Pre-scan — mode selector ═══ */}
              {preScan && (
                <div className={cn(EMPTY_HERO, "h-auto py-4 max-w-none")}>
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="p-6 bg-primary/8 rounded-3xl mb-6 shrink-0"
                  >
                    <Brain className="w-16 h-16 text-primary" />
                  </motion.div>
                  <h2 className="text-xl font-headline font-bold mb-3">
                    {NAMES.duplicates.label}
                  </h2>
                  <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
                    Clean your network by merging duplicate contacts
                  </p>

                  {/*
                    Scan mode selector. Each mode is a card that is a
                    control. The chosen one is the selected row, which mixes
                    its tint onto the card's white face and keeps the card's
                    shadow, and it wears a filled `RadioDot`, so it is chosen
                    by shape as well as by hue.
                  */}
                  <div className="w-full space-y-2 mb-8">
                    {scanModes.map(({ mode, icon, title, desc }) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={selectedMode === mode}
                        onClick={() => setSelectedMode(mode)}
                        className={cn(
                          CARD_INTERACTIVE,
                          "w-full flex items-center gap-4 p-4 text-left",
                          selectedMode === mode && SELECTED_ROW,
                        )}
                      >
                        <RadioDot checked={selectedMode === mode} />
                        <div
                          className={cn(
                            "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                            selectedMode === mode
                              ? "bg-primary/15"
                              : "bg-surface-container-low",
                          )}
                        >
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-on-surface">
                            {title}
                          </div>
                          <div className="text-xs text-on-surface-variant">
                            {desc}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleStartScan}
                    disabled={isStarting}
                    className="btn-primary"
                  >
                    {isStarting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <ScanSearch className="w-5 h-5" />
                    )}
                    Begin scan
                  </button>
                </div>
              )}

              {/* ═══ Phase 1b: Queued behind another account ═══ */}
              {/*
                Deliberately not a progress card. The scan exists on the
                server and has zero progress to report, and a progress bar
                frozen at nothing reads as a hang. This says what is true:
                somebody else is scanning, and this one starts by itself.
              */}
              {isQueued && !scan && (
                <div className="flex flex-col items-center">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md"
                  >
                    <div className={cn(CARD, "text-center space-y-3")}>
                      <span
                        className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center mx-auto",
                          TONE_WASH.primary,
                        )}
                      >
                        <Hourglass className="w-6 h-6" />
                      </span>
                      <h3 className="font-bold text-on-surface">
                        Waiting for another scan to finish
                      </h3>
                      <p className="text-sm text-on-surface-variant text-pretty">
                        Another user's scan is running. Yours is booked and will
                        start automatically — you can leave this page.
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        Only one scan runs at a time, because a scan reads every
                        contact it owns and shares one AI budget.
                      </p>
                    </div>
                  </motion.div>
                </div>
              )}

              {/* ═══ Phase 2: Scanning — progress card ═══ */}
              {isScanning && scan && (
                <div className="flex flex-col items-center">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md"
                  >
                    <div className={cn(CARD, "p-0 overflow-hidden")}>
                      {/* Header */}
                      <div className="px-5 py-4 bg-surface-container-low flex items-center gap-3">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: "linear",
                          }}
                        >
                          <Cpu className="w-5 h-5 text-primary" />
                        </motion.div>
                        <div className="flex-1">
                          <div className="text-sm font-bold text-on-surface">
                            Dedupe scan
                          </div>
                          <div className="text-[11px] text-on-surface-variant">
                            {MODE_NAME[scan.mode] ?? scan.mode} mode
                          </div>
                        </div>
                        <span className="text-xs text-on-surface-variant tabular-nums">
                          {scan.contactsScanned}/{scan.totalContacts || "…"}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="h-1.5 bg-surface-container-high">
                        <motion.div
                          className="h-full bg-gradient-to-r from-primary-dim to-primary-container"
                          animate={{
                            width:
                              scan.totalContacts > 0
                                ? `${(scan.contactsScanned / scan.totalContacts) * 100}%`
                                : "0%",
                          }}
                          transition={{ duration: DURATION.slow, ease: EASE }}
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
                          {/* Every mode runs the exact-match pass. The
                              rows used to test the old mode names only
                              (deterministic, ai, both), so the three modes
                              the picker offers showed neither row. */}
                          <PhaseRow
                            icon={<Shield className="w-3.5 h-3.5" />}
                            label="Exact matches"
                            status={stepStatus(
                              scan.phase,
                              "deterministic",
                              "deterministic",
                            )}
                            detail={
                              scan.deterministicFound > 0
                                ? `${scan.deterministicFound} found`
                                : undefined
                            }
                          />
                          {runsAiPass(scan.mode) && (
                            <PhaseRow
                              icon={<Sparkles className="w-3.5 h-3.5" />}
                              label="AI analysis"
                              status={stepStatus(scan.phase, "blocking", "ai")}
                              detail={
                                scan.aiCandidatesFound > 0
                                  ? `${scan.aiCandidatesFound} found`
                                  : undefined
                              }
                            />
                          )}
                          <PhaseRow
                            icon={<GitMerge className="w-3.5 h-3.5" />}
                            label="Cluster grouping"
                            status={stepStatus(
                              scan.phase,
                              "clustering",
                              "clustering",
                            )}
                            detail={
                              scan.clustersFound > 0
                                ? `${scan.clustersFound} cluster${scan.clustersFound !== 1 ? "s" : ""}`
                                : undefined
                            }
                          />
                        </div>

                        {/* Findings so far */}
                        {(scan.deterministicFound > 0 ||
                          scan.aiCandidatesFound > 0) && (
                          <div className="text-xs text-on-surface-variant bg-surface-container-low rounded-xl px-3 py-2 flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-primary" />
                            <span>
                              <span className="font-bold text-on-surface">
                                {scan.deterministicFound +
                                  scan.aiCandidatesFound}
                              </span>{" "}
                              potential pair
                              {scan.deterministicFound +
                                scan.aiCandidatesFound !==
                              1
                                ? "s"
                                : ""}{" "}
                              found so far
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Help text */}
                    <p className="text-xs text-on-surface-variant text-center mt-4">
                      You can navigate away — the scan will continue in the
                      background
                    </p>
                  </motion.div>
                </div>
              )}

              {/* ═══ Phase 3: Scan error ═══ */}
              {scanError && scan && (
                <div className="flex flex-col items-center">
                  <AlertCircle className="w-12 h-12 text-error mb-4" />
                  <p className="text-error font-bold">Scan failed</p>
                  <p className="text-sm text-on-surface-variant mt-1">
                    {scan.error}
                  </p>
                  <button
                    onClick={handleNewScan}
                    className="mt-4 btn-secondary"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* ═══ Phase 3: All clean (no results) ═══ */}
              {scanComplete && clusters.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center"
                >
                  <EmptyState
                    icon={CheckCircle2}
                    title="No duplicates found"
                    body="Run a scan after an import to check again."
                    action={{
                      label: "Scan again",
                      icon: ScanSearch,
                      onClick: handleNewScan,
                    }}
                  />
                </motion.div>
              )}

              {/* ═══ Phase 3: Results — Swipe view ═══ */}
              {hasResults && resultView === "swipe" && (
                <>
                  {/* All processed in swipe view */}
                  {totalActive === 0 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center"
                    >
                      <EmptyState
                        /*
                          The one empty state in the app that is a reward
                          rather than a gap, so the bird stands in for the
                          check mark and hops once when it arrives.
                        */
                        illustration={
                          <CorvidMark
                            size={96}
                            hop
                            className="text-primary/60"
                          />
                        }
                        title="All reviewed"
                        body={
                          <>
                            {mergedIds.size > 0
                              ? `Merged ${mergedIds.size} cluster${mergedIds.size > 1 ? "s" : ""}. Your network is pristine.`
                              : "All clusters have been reviewed."}
                            {dismissed.size > 0 && (
                              <span className="block text-xs mt-1">
                                ({dismissed.size} cluster
                                {dismissed.size > 1 ? "s" : ""} kept separate)
                              </span>
                            )}
                          </>
                        }
                        action={{
                          label: "New scan",
                          icon: ScanSearch,
                          onClick: handleNewScan,
                        }}
                      />
                    </motion.div>
                  )}

                  {/* Active swipe card */}
                  {currentCluster && (
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
                  )}
                </>
              )}

              {/* ═══ Phase 3: Results — List view ═══ */}
              {hasResults && resultView === "list" && (
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
            // The bottom padding clears the phone tab bar, like the auto
            // tab's body, so the last contact and Compare scroll above it.
            className={cn("pt-6 pb-24 md:pb-6", PAGE_X)}
          >
            <ManualMerge />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Merge activity slide-out panel */}
      <AnimatePresence>
        {showActivity && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setShowActivity(false)}
            />
            {/* Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-surface z-50 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 shrink-0">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-on-surface-variant" />
                  <h2 className="text-lg font-headline font-bold">
                    Merge activity
                  </h2>
                </div>
                <button
                  onClick={() => setShowActivity(false)}
                  aria-label="Close merge activity"
                  className={ICON_BTN}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-8">
                <ActivityFeed />
              </div>
            </motion.div>
          </>
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
  status: "pending" | "active" | "done";
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div
        className={cn(
          "shrink-0 transition-colors",
          status === "done"
            ? "text-success"
            : status === "active"
              ? "text-primary"
              : "text-on-surface-variant/30",
        )}
      >
        {status === "done" ? (
          <CheckCircle2 className="w-3.5 h-3.5" />
        ) : status === "active" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          icon
        )}
      </div>
      <span
        className={cn(
          "flex-1",
          status === "done"
            ? "text-on-surface"
            : status === "active"
              ? "text-on-surface font-medium"
              : "text-on-surface-variant",
        )}
      >
        {label}
      </span>
      {detail && (
        <span
          className={cn(
            "text-xs tabular-nums",
            status === "done" ? "text-success" : "text-primary",
          )}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
