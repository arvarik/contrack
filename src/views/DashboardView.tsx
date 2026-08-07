import React, { useEffect, useState, useRef } from "react";
import { isTypingTarget } from "../lib/keyboard";
import {
  useDashboard,
  useDailyInsight,
  useCompletedActionItems,
  useCompleteActionItem,
  useUpdateActionItem,
  useDedupeCount,
} from "../api";
import { useNavigate, useSearchParams } from "react-router-dom";
import confetti from "canvas-confetti";
import { DashboardSkeleton } from "./dashboard/DashboardSkeleton";
import { MetricCard } from "./dashboard/MetricCard";
import { DailyInsightCard } from "./dashboard/DailyInsightCard";
import { ActionItemSwimlane } from "./dashboard/ActionItemSwimlane";
import { NetworkHealthPanel } from "./dashboard/NetworkHealthPanel";
import { NetworkCompositionModal } from "./dashboard/NetworkCompositionModal";
import { InteractionVelocityModal } from "./dashboard/InteractionVelocityModal";
import { NetworkGrowthModal } from "./dashboard/NetworkGrowthModal";
import {
  Users,
  HeartPulse,
  ActivitySquare,
  UserPlus,
  PartyPopper,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Inbox,
  LayoutDashboard,
} from "lucide-react";
import {
  PAGE_TITLE,
  EMPTY_STATE,
  EMPTY_HERO,
  CARD_COMPACT,
  TAB_CONTAINER,
  tabItem,
} from "../lib/styles";
import { cn } from "../lib/utils";
import { tileDelay } from "../lib/motion";
import { motion, AnimatePresence } from "motion/react";
import { format, addDays } from "date-fns";
import { usePageTitle } from "../hooks/usePageTitle";
import { SuggestionReviewQueue } from "./dedupe/components";

type PulseTab = "pulse" | "suggestions";

const CompletedActionsBar = () => {
  const { data: completedItems = [] } = useCompletedActionItems();
  const [expanded, setExpanded] = useState(false);

  if (completedItems.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-2 relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-surface-container-low transition-colors group cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary opacity-60" />
          <span className="text-sm font-bold text-on-surface-variant group-hover:text-primary transition-colors">
            Completed Follow-ups
          </span>
          <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-[10px] items-center flex font-mono text-on-surface-variant font-bold leading-none h-5">
            {completedItems.length}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-on-surface-variant opacity-50" />
        ) : (
          <ChevronDown className="w-4 h-4 text-on-surface-variant opacity-50" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden flex flex-col gap-2 pl-2 border-l-2 border-surface-container ml-2"
          >
            {completedItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  CARD_COMPACT,
                  "opacity-60 saturate-50 hover:opacity-100 hover:saturate-100 transition-all p-3 flex sm:items-center sm:flex-row flex-col gap-2",
                )}
              >
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="font-bold text-sm text-on-surface truncate pr-2 line-through">
                    {item.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="text-xs font-semibold text-on-surface-variant truncate">
                      {item.contactName || "Unknown"}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-[10px] uppercase font-bold text-on-surface-variant tracking-widest pl-1 sm:pl-0">
                  {item.completedAt
                    ? format(new Date(item.completedAt), "MMM d, yyyy")
                    : ""}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const DashboardView = () => {
  const mountStart = useRef(performance.now());
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(
        `[Perf] DashboardView mounted in ${(performance.now() - mountStart.current).toFixed(2)}ms`,
      );
    }
  }, []);

  const {
    data: dashboard,
    isLoading: isDashboardLoading,
    isError,
  } = useDashboard();

  useEffect(() => {
    if (!isDashboardLoading && dashboard && import.meta.env.DEV) {
      console.log(
        `[Perf] DashboardView data ready: time from mount=${(performance.now() - mountStart.current).toFixed(2)}ms`,
      );
    }
  }, [isDashboardLoading, !!dashboard]);

  const { data: insight, isLoading: isInsightLoading } = useDailyInsight();
  const [isCompositionOpen, setIsCompositionOpen] = useState(false);
  const [isVelocityOpen, setIsVelocityOpen] = useState(false);
  const [isGrowthOpen, setIsGrowthOpen] = useState(false);

  const completeAction = useCompleteActionItem();
  const updateAction = useUpdateActionItem();
  const navigate = useNavigate();

  usePageTitle("Relationship Pulse");

  const { data: dedupeCount } = useDedupeCount();
  const pendingSuggestions = dedupeCount?.count ?? 0;
  const [searchParams] = useSearchParams();
  const initialTab =
    searchParams.get("tab") === "suggestions" ? "suggestions" : "pulse";
  const [activeTab, setActiveTab] = useState<PulseTab>(initialTab);

  const prevHasItemsRef = useRef<boolean | null>(null);

  const hasActionItems =
    dashboard &&
    (dashboard.overdue.length > 0 ||
      dashboard.dueToday.length > 0 ||
      dashboard.upcoming.length > 0);
  const firstActionItem = dashboard
    ? dashboard.overdue[0] || dashboard.dueToday[0] || dashboard.upcoming[0]
    : null;

  useEffect(() => {
    if (prevHasItemsRef.current === true && hasActionItems === false) {
      // Fire confetti when the last item is cleared!
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        // Deliberately the vivid pre-accessibility palette: confetti carries
        // no text and has no contrast duty, and the AA-safe tones read as
        // muted when the point is celebration.
        colors: ["#009EDB", "#10B981", "#F59E0B"],
      });
    }
    // Only start tracking after first non-null value — prevents confetti on initial empty load
    if (hasActionItems !== undefined) {
      prevHasItemsRef.current = hasActionItems ?? null;
    }
  }, [hasActionItems]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (!firstActionItem) return;
      // Guard against double-firing while a mutation is in-flight
      if (completeAction.isPending || updateAction.isPending) return;

      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        completeAction.mutate(firstActionItem.id);
      } else if (key === "s") {
        e.preventDefault();
        updateAction.mutate({
          id: firstActionItem.id,
          data: { dueAt: addDays(new Date(), 1).toISOString() },
        });
      } else if (key === "l") {
        e.preventDefault();
        navigate(`/contact/${firstActionItem.contactId}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [firstActionItem, completeAction, updateAction, navigate]);

  if (isError) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <div className={EMPTY_STATE}>
          <HeartPulse className="w-12 h-12 text-error mx-auto mb-4 opacity-50" />
          <h2 className="text-xl font-bold text-on-surface mb-2">
            System Disconnected
          </h2>
          <p>Failed to load the relationship pulse dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-surface nice-scrollbar relative">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-10 flex flex-col gap-6 sm:gap-8 pb-32">
        {/* Header — stacks under 640px so the tab bar never squeezes the title */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <h1 className={PAGE_TITLE}>Pulse</h1>
          {/* Tabs */}
          <div className={cn(TAB_CONTAINER, "w-full sm:w-fit")}>
            <button
              onClick={() => setActiveTab("pulse")}
              className={cn(
                tabItem(activeTab === "pulse"),
                "flex flex-1 sm:flex-none items-center justify-center gap-2",
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              Network
            </button>
            <button
              onClick={() => setActiveTab("suggestions")}
              className={cn(
                tabItem(activeTab === "suggestions"),
                "flex flex-1 sm:flex-none items-center justify-center gap-2 relative",
              )}
            >
              <Inbox className="w-4 h-4" />
              Suggestions
              {pendingSuggestions > 0 && (
                <span className="ml-1.5 flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Loading State */}
        {activeTab === "pulse" && (isDashboardLoading || !dashboard) ? (
          <DashboardSkeleton />
        ) : activeTab === "pulse" && dashboard ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6 items-start">
            {/* Top KPI Row — 1 up on phones, 3 up from md */}
            <div className="col-span-full grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              <MetricCard
                label="Active Network"
                value={dashboard.metrics.totalActive}
                icon={Users}
                delay={tileDelay(0)}
                onClick={() => setIsCompositionOpen(true)}
              />
              <MetricCard
                label="Interactions"
                value={dashboard.metrics.totalInteractions30d}
                subValue="interactions last month"
                icon={ActivitySquare}
                delay={tileDelay(1)}
                onClick={() => setIsVelocityOpen(true)}
              />
              <MetricCard
                label="Network Growth"
                value={dashboard.metrics.newContacts30d}
                subValue="added this month"
                icon={UserPlus}
                delay={tileDelay(2)}
                onClick={() => setIsGrowthOpen(true)}
              />
            </div>

            {/* AI Insight */}
            <DailyInsightCard
              insight={insight}
              isLoading={isInsightLoading}
              delay={tileDelay(3)}
            />

            {/* Left Column: Action Items */}
            <div className="col-span-full xl:col-span-8 flex flex-col gap-6 sm:gap-8">
              {!hasActionItems ? (
                <div
                  style={{ animationDelay: tileDelay(4) }}
                  className={cn(EMPTY_HERO, "tile-enter py-10")}
                >
                  <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                    <PartyPopper className="w-10 h-10 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold text-on-surface">
                    No Followups
                  </h2>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  <ActionItemSwimlane
                    title="Overdue"
                    items={dashboard.overdue}
                    theme="urgent"
                    delay={tileDelay(4)}
                    firstActionItemId={firstActionItem?.id}
                  />
                  <ActionItemSwimlane
                    title="Due Today"
                    items={dashboard.dueToday}
                    theme="today"
                    delay={tileDelay(5)}
                    firstActionItemId={firstActionItem?.id}
                  />
                  <ActionItemSwimlane
                    title="Upcoming"
                    items={dashboard.upcoming}
                    theme="upcoming"
                    delay={tileDelay(6)}
                    firstActionItemId={firstActionItem?.id}
                  />
                </div>
              )}

              {/* COMPLETED ACTIONS ACCORDION */}
              <CompletedActionsBar />
            </div>

            {/* Right Column: Network Health */}
            <div className="col-span-full xl:col-span-4 flex flex-col gap-6">
              <NetworkHealthPanel payload={dashboard} delay={tileDelay(5)} />
            </div>
          </div>
        ) : activeTab === "suggestions" ? (
          /* Suggestions Tab Content */
          <div className="max-w-4xl mx-auto space-y-10 w-full">
            {/* Merge Suggestions — primary section */}
            <section>
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-primary/10 rounded-xl">
                  <Inbox className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-headline font-bold text-on-surface">
                    Merge Suggestions
                  </h2>
                  <p className="text-xs text-on-surface-variant">
                    Contacts that may be the same person
                  </p>
                </div>
              </div>
              <SuggestionReviewQueue />
            </section>
          </div>
        ) : null}
      </div>

      {dashboard && (
        <>
          <NetworkCompositionModal
            isOpen={isCompositionOpen}
            onClose={() => setIsCompositionOpen(false)}
            composition={dashboard}
          />
          <InteractionVelocityModal
            isOpen={isVelocityOpen}
            onClose={() => setIsVelocityOpen(false)}
            breakdown={dashboard.interactionBreakdown30d}
          />
          <NetworkGrowthModal
            isOpen={isGrowthOpen}
            onClose={() => setIsGrowthOpen(false)}
            timeline={dashboard.networkGrowthTimeline30d}
            totalCount={dashboard.metrics.newContacts30d}
          />
        </>
      )}
    </div>
  );
};
