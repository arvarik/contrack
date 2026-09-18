import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { addDays } from "date-fns";
import { HeartPulse } from "lucide-react";
import {
  useDashboard,
  useDailyInsight,
  useDashboardActivity,
  useContacts,
  useCompleteActionItem,
  useUpdateActionItem,
  useDedupeCount,
} from "../../api";
import { isTypingTarget } from "../../lib/keyboard";
import { useAiAllowed } from "../../hooks/useAiAllowed";
import { usePageTitle } from "../../hooks/usePageTitle";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";
import { NAMES } from "../../lib/names";
import { openQuickNote } from "../../lib/appEvents";
import { EMPTY_STATE } from "../../lib/styles";
import { resolveLayout } from "./lib/layout";
import { buildUpNextQueue, computeNextHighlightIndex } from "./lib/upNext";
import { getUpcomingBirthdays } from "./lib/birthdays";
import { PulseHeader } from "./components/PulseHeader";
import { PulseSkeleton } from "./components/PulseSkeleton";
import { WelcomeOffice } from "./components/WelcomeOffice";
import { UpNextCard } from "./cards/UpNextCard";
import { CompletedCard } from "./cards/CompletedCard";
import { InsightCard } from "./cards/InsightCard";
import { InboxCard } from "./cards/InboxCard";
import { ComingUpCard } from "./cards/ComingUpCard";
import { NewPeopleCard } from "./cards/NewPeopleCard";
import {
  ActivityCardStopgap,
  MomentumCardStopgap,
  CompositionCardStopgap,
} from "./cards/NetworkStopgapCards";
const DuplicatesPage = React.lazy(() =>
  import("./pages/DuplicatesPage").then((m) => ({ default: m.DuplicatesPage })),
);

const PulseOffice = () => {
  const mountStart = useRef(performance.now());
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(
        `[Perf] PulseView mounted in ${(performance.now() - mountStart.current).toFixed(2)}ms`,
      );
    }
  }, []);

  const navigate = useNavigate();

  usePageTitle(NAMES.pulse.title);

  const {
    data: dashboard,
    isLoading: isDashboardLoading,
    isError,
  } = useDashboard();

  const aiAllowed = useAiAllowed();
  const { data: insight, isLoading: isInsightLoading } = useDailyInsight({
    enabled: aiAllowed,
  });

  const { data: activity } = useDashboardActivity();
  const { data: contacts = [] } = useContacts();
  const { data: dedupeCount } = useDedupeCount();
  const pendingSuggestions = dedupeCount?.count ?? 0;

  const { preferences } = usePreferences();
  const singleKey = useSingleKeyShortcuts();

  const completeAction = useCompleteActionItem();
  const updateAction = useUpdateActionItem();

  // Map of contacts for fast lookup (e.g. meeting attendee avatars)
  const contactsMap = useMemo(() => {
    const map = new Map<
      string,
      { name: string; avatarUrl?: string | null; themeColor?: string }
    >();
    for (const c of contacts) {
      map.set(c.id, {
        name: c.name,
        avatarUrl: c.avatarUrl,
        themeColor: c.themeColor,
      });
    }
    return map;
  }, [contacts]);

  // Compute upcoming birthdays within 14 days client-side
  const upcomingBirthdays = useMemo(() => {
    return getUpcomingBirthdays(contacts, new Date(), 14);
  }, [contacts]);

  // Build the ranked Up Next queue
  const upNext = useMemo(() => {
    if (!dashboard) {
      return buildUpNextQueue({});
    }
    return buildUpNextQueue({
      overdue: dashboard.overdue,
      dueToday: dashboard.dueToday,
      upcoming: dashboard.upcoming,
      birthdays: upcomingBirthdays,
      slipping: dashboard.atRisk,
    });
  }, [dashboard, upcomingBirthdays]);

  // Selected index in Up Next
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const prevItemsRef = useRef(upNext.items);

  // Maintain highlight index when items leave or change
  useEffect(() => {
    setSelectedIndex((current) =>
      computeNextHighlightIndex(current, prevItemsRef.current, upNext.items),
    );
    prevItemsRef.current = upNext.items;
  }, [upNext.items]);

  const highlightedItem =
    selectedIndex >= 0 && selectedIndex < upNext.items.length
      ? upNext.items[selectedIndex]
      : null;

  // Screen reader announcement for keyboard navigation
  const [liveStatus, setLiveStatus] = useState("");
  useEffect(() => {
    if (highlightedItem) {
      setLiveStatus(
        `Row ${selectedIndex + 1} of ${upNext.items.length}, ${highlightedItem.contactName}, ${highlightedItem.dueChip.text.toLowerCase()}`,
      );
    } else {
      setLiveStatus("");
    }
  }, [selectedIndex, highlightedItem, upNext.items.length]);

  // Keyboard navigation (J / K / D / S / L / Enter)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Enter opens contact profile (not a bare letter, always active)
      if (e.key === "Enter") {
        if (highlightedItem) {
          e.preventDefault();
          navigate(`/contact/${highlightedItem.contactId}`);
        }
        return;
      }

      // Single-key shortcuts respect preference
      if (!singleKey) return;

      const key = e.key.toLowerCase();

      if (key === "j") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < upNext.items.length - 1 ? prev + 1 : prev,
        );
      } else if (key === "k") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (key === "d") {
        if (highlightedItem?.hasCheckAction) {
          e.preventDefault();
          completeAction.mutate(highlightedItem.id);
        }
      } else if (key === "s") {
        if (highlightedItem?.hasCheckAction) {
          e.preventDefault();
          updateAction.mutate({
            id: highlightedItem.id,
            data: { dueAt: addDays(new Date(), 1).toISOString() },
          });
        }
      } else if (key === "l") {
        if (highlightedItem) {
          e.preventDefault();
          openQuickNote(highlightedItem.contactId);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    highlightedItem,
    singleKey,
    upNext.items.length,
    completeAction,
    updateAction,
    navigate,
  ]);

  // Layout resolution
  const resolvedLayout = useMemo(() => {
    return resolveLayout(preferences?.pulseLayout);
  }, [preferences?.pulseLayout]);

  const upNextCardRef = useRef<HTMLDivElement>(null);
  const scrollToUpNext = () => {
    upNextCardRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToComingUp = () => {
    const el = document.querySelector('[data-card-id="coming-up"]');
    el?.scrollIntoView({ behavior: "smooth" });
  };

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

  if (isDashboardLoading || !dashboard) {
    return <PulseSkeleton />;
  }

  const isZeroContacts = dashboard.metrics.totalActive === 0;

  return (
    <div className="w-full h-full overflow-y-auto bg-surface nice-scrollbar relative">
      {/* Screen reader live region */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveStatus}
      </div>

      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 md:p-10 flex flex-col gap-6 sm:gap-8 pb-32">
        {/* Header */}
        <PulseHeader
          completedToday={activity?.today.completed ?? 0}
          dueToday={upNext.counts.today}
          overdueCount={upNext.counts.overdue}
          birthdayCount={upNext.counts.birthdays}
          streak={activity?.streak.current ?? 0}
          onScrollToUpNext={scrollToUpNext}
          onScrollToComingUp={scrollToComingUp}
        />

        {/* Content: Welcome Office if 0 contacts, else 3-column Grid */}
        {isZeroContacts ? (
          <WelcomeOffice />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Column 1: Focus (Up next, Completed) */}
            <div className="order-1 lg:col-span-5 2xl:col-span-4 flex flex-col gap-6">
              {resolvedLayout.visible.focus.map((cardId) => {
                if (cardId === "up-next") {
                  return (
                    <div key="up-next" ref={upNextCardRef}>
                      <UpNextCard
                        items={upNext.items}
                        groups={upNext.groups}
                        selectedIndex={selectedIndex}
                        onSelectIndex={setSelectedIndex}
                        onComplete={(id) => completeAction.mutate(id)}
                        onLog={(cid) => openQuickNote(cid)}
                        onOpenContact={(cid) => navigate(`/contact/${cid}`)}
                      />
                    </div>
                  );
                }
                if (cardId === "completed") {
                  return <CompletedCard key="completed" />;
                }
                return null;
              })}
            </div>

            {/* Column 2: Intelligence (Insight, Inbox, Coming up, New people) */}
            <div className="order-3 lg:col-span-12 2xl:order-2 2xl:col-span-4 flex flex-col gap-6">
              {resolvedLayout.visible.intel.map((cardId) => {
                if (cardId === "insight") {
                  return (
                    <InsightCard
                      key="insight"
                      insight={insight}
                      isLoading={isInsightLoading}
                      aiAllowed={aiAllowed}
                    />
                  );
                }
                if (cardId === "inbox") {
                  return (
                    <InboxCard
                      key="inbox"
                      pendingDuplicates={pendingSuggestions}
                      ghosts={dashboard.ghosts}
                      hygiene={dashboard.hygiene}
                      correspondents={dashboard.correspondents}
                    />
                  );
                }
                if (cardId === "coming-up") {
                  return (
                    <ComingUpCard
                      key="coming-up"
                      birthdays={upcomingBirthdays}
                      meetings={dashboard.meetings}
                      contactsMap={contactsMap}
                    />
                  );
                }
                if (cardId === "new-people") {
                  return (
                    <NewPeopleCard
                      key="new-people"
                      newContacts30d={dashboard.metrics.newContacts30d}
                      recentlyAdded={dashboard.recentlyAdded}
                      timeline={dashboard.networkGrowthTimeline30d}
                    />
                  );
                }
                return null;
              })}
            </div>

            {/* Column 3: Network (Activity, Momentum, Composition stopgap) */}
            <div className="order-2 lg:col-span-7 2xl:order-3 2xl:col-span-4 flex flex-col gap-6">
              {resolvedLayout.visible.network.map((cardId) => {
                if (cardId === "activity") {
                  return (
                    <ActivityCardStopgap key="activity" dashboard={dashboard} />
                  );
                }
                if (cardId === "momentum") {
                  return (
                    <MomentumCardStopgap key="momentum" dashboard={dashboard} />
                  );
                }
                if (cardId === "composition") {
                  return (
                    <CompositionCardStopgap
                      key="composition"
                      dashboard={dashboard}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const PulseView = () => {
  const [searchParams] = useSearchParams();
  if (searchParams.get("tab") === "suggestions") {
    return <Navigate to="/pulse/duplicates" replace />;
  }

  return (
    <Routes>
      <Route
        path="duplicates"
        element={
          <React.Suspense fallback={null}>
            <DuplicatesPage />
          </React.Suspense>
        }
      />
      <Route
        path="suggestions"
        element={<Navigate to="/pulse/duplicates" replace />}
      />
      <Route path="*" element={<PulseOffice />} />
    </Routes>
  );
};

export { PulseView as DashboardView };
export default PulseView;
