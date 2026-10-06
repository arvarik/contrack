import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import {
  useDashboard,
  useDailyInsight,
  useDashboardActivity,
  useContacts,
  useCompleteActionItem,
  useUpdateActionItem,
  useDedupeCount,
} from "../../api";
import { useAiAllowed } from "../../hooks/useAiAllowed";
import { usePageTitle } from "../../hooks/usePageTitle";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";
import { NAMES } from "../../lib/names";
import { openQuickNote } from "../../lib/appEvents";
import { scrollBehavior } from "../../lib/a11y";
import { withUndo } from "../../lib/undoToast";
import {
  startPendingDelete,
  useHiddenPendingIds,
} from "../../lib/pendingDeletes";
import { PAGE_TOP, PAGE_X } from "../../lib/styles";
import { cn } from "../../lib/utils";
import {
  resolveLayout,
  pulseLayoutReducer,
  PULSE_COLUMNS,
  CARD_TITLES,
  COLUMN_NAMES,
  DEFAULT_PULSE_LAYOUT,
  getDefaultColumnForCard,
  type PulseColumn,
  type PulseCardId,
  type PulseLayoutAction,
} from "./lib/layout";
import {
  buildUpNextQueue,
  computeNextHighlightIndex,
  type UpNextItem,
} from "./lib/upNext";
import { isPageKeyTaken } from "../../lib/keyboard";
import { getUpcomingBirthdays } from "./lib/birthdays";
import { jumpToGroup } from "./lib/jumpToGroup";
import { Masthead, type JumpTarget } from "./components/Masthead";
import { PulseSkeleton } from "./components/PulseSkeleton";
import { WelcomeOffice } from "./components/WelcomeOffice";
import { PulseGrid } from "./components/PulseGrid";
import { UpNextCard } from "./cards/UpNextCard";
import { CompletedCard } from "./cards/CompletedCard";
import { InsightCard } from "./cards/InsightCard";
import { InboxCard } from "./cards/InboxCard";
import { ComingUpCard } from "./cards/ComingUpCard";
import { ActivityCard } from "./cards/ActivityCard";
import { KeepingUpCard } from "./cards/KeepingUpCard";
import { CompositionCard } from "./cards/CompositionCard";
import { LoadFailed } from "../../components/ui/LoadFailed";

const DuplicatesPage = React.lazy(() =>
  import("./pages/DuplicatesPage").then((m) => ({ default: m.DuplicatesPage })),
);

/** The single keys that walk or act on the selected Up next row. */
const QUEUE_KEYS = new Set(["j", "k", "d", "s", "l"]);

const logNote = (contactId: string) => openQuickNote(contactId);

const PulseOffice = () => {
  const navigate = useNavigate();

  usePageTitle(NAMES.pulse.title);

  const {
    data: dashboard,
    isLoading: isDashboardLoading,
    isError,
    refetch,
  } = useDashboard();

  const aiAllowed = useAiAllowed();
  const {
    data: insight,
    isLoading: isInsightLoading,
    refetch: refetchInsight,
  } = useDailyInsight({ enabled: aiAllowed });

  const { data: activity } = useDashboardActivity();
  const { data: contacts = [] } = useContacts();
  const { data: dedupeCount } = useDedupeCount();
  const pendingSuggestions = dedupeCount?.count ?? 0;

  const { preferences, setPreference } = usePreferences();
  const singleKey = useSingleKeyShortcuts();

  const completeAction = useCompleteActionItem();
  const { mutate: updateFollowUp } = useUpdateActionItem();
  /** Follow-ups done this session, in their undo window or after it. */
  const hiddenIds = useHiddenPendingIds();

  // No route reopens a follow-up, so Undo works by waiting: the request goes
  // when the toast's Undo is gone (`lib/pendingDeletes`). Stable, so the
  // memoized queue element survives.
  const completeAsync = completeAction.mutateAsync;
  const handleComplete = useCallback(
    (id: string) =>
      startPendingDelete({
        id,
        send: () => completeAsync(id),
        message: "Follow-up done",
        errorMessage:
          "Could not complete the follow-up. It is back in the queue",
        flushUrl: `/action-items/${encodeURIComponent(id)}/complete`,
        flushMethod: "PATCH",
      }),
    [completeAsync],
  );

  const handleSnooze = useCallback(
    (item: UpNextItem, days: number) => {
      const before = item.dueAt;
      const dueAt = addDays(new Date(), days).toISOString();
      updateFollowUp(
        { id: item.id, data: { dueAt } },
        {
          onSuccess: () =>
            toast.success(
              `Follow-up snoozed to ${new Date(dueAt).toLocaleDateString(
                undefined,
                { weekday: "long", month: "short", day: "numeric" },
              )}`,
              before
                ? withUndo(() =>
                    updateFollowUp({ id: item.id, data: { dueAt: before } }),
                  )
                : undefined,
            ),
          onError: () => toast.error("Could not snooze the follow-up"),
        },
      );
    },
    [updateFollowUp],
  );

  const [isEditing, setIsEditing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Set by `PulseGrid` while a card is in the air. The letter keys wait: C
  // would end customize mode under a keyboard drag.
  const draggingRef = useRef(false);
  /** The masthead's More menu, where Customize layout lives. */
  const moreRef = useRef<HTMLButtonElement>(null);
  // Where focus goes after the next layout change. Hide, Show and Move
  // remove the focused button, and focus would fall to the page.
  const refocusRef = useRef<(() => HTMLElement | null) | null>(null);

  const handleToggleCustomize = useCallback(
    () => setIsEditing((prev) => !prev),
    [],
  );
  const handleDone = useCallback(() => setIsEditing(false), []);

  // Ending the mode removes the bar and the card controls, so lost focus
  // goes to the More menu.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (wasEditingRef.current === isEditing) return;
    wasEditingRef.current = isEditing;
    setAnnouncement(isEditing ? "Layout editing on" : "Layout editing off");
    if (!isEditing && document.activeElement === document.body) {
      moreRef.current?.focus();
    }
  }, [isEditing]);

  const resolvedLayout = useMemo(() => {
    return resolveLayout(preferences?.pulseLayout);
  }, [preferences?.pulseLayout]);

  const handleHideCard = useCallback(
    (cardId: string) => {
      const raw = preferences?.pulseLayout ?? DEFAULT_PULSE_LAYOUT;
      const next = pulseLayoutReducer(raw, { type: "hide", cardId });
      setPreference("pulseLayout", next);
      const title = CARD_TITLES[cardId as PulseCardId] || cardId;
      setAnnouncement(`Hidden ${title}`);
      refocusRef.current = () =>
        document.querySelector(
          `[data-testid="hidden-cards-tray"] [aria-label="Show ${title}"]`,
        );
    },
    [preferences?.pulseLayout, setPreference],
  );

  const handleShowCard = useCallback(
    (cardId: string) => {
      const raw = preferences?.pulseLayout ?? DEFAULT_PULSE_LAYOUT;
      const next = pulseLayoutReducer(raw, { type: "show", cardId });
      setPreference("pulseLayout", next);
      const title = CARD_TITLES[cardId as PulseCardId] || cardId;
      setAnnouncement(`Restored ${title}`);
      refocusRef.current = () =>
        document.querySelector(
          `[data-flip-id="${cardId}"] [aria-label="Hide ${title}"]`,
        );
    },
    [preferences?.pulseLayout, setPreference],
  );

  const handleMoveToColumn = useCallback(
    (cardId: string, targetColumn: PulseColumn) => {
      const raw = preferences?.pulseLayout ?? DEFAULT_PULSE_LAYOUT;
      const next = pulseLayoutReducer(raw, {
        type: "move",
        cardId,
        targetColumn,
      });
      setPreference("pulseLayout", next);
      const title = CARD_TITLES[cardId as PulseCardId] || cardId;
      setAnnouncement(`Moved ${title} to ${COLUMN_NAMES[targetColumn]}`);
      // The card mounts again in its new column. Its Move button takes focus.
      refocusRef.current = () =>
        document.querySelector(
          `[data-flip-id="${cardId}"] [aria-label="Move ${title}"]`,
        );
    },
    [preferences?.pulseLayout, setPreference],
  );

  const handleMoveStep = useCallback(
    (cardId: string, direction: -1 | 1) => {
      const raw = preferences?.pulseLayout ?? DEFAULT_PULSE_LAYOUT;
      const resolved = resolveLayout(raw);
      for (const col of PULSE_COLUMNS) {
        const idx = resolved.visible[col].indexOf(cardId as PulseCardId);
        if (idx !== -1) {
          const targetIdx = idx + direction;
          if (targetIdx >= 0 && targetIdx < resolved.visible[col].length) {
            const list = [...resolved.visible[col]];
            [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
            const next = pulseLayoutReducer(raw, {
              type: "reorder",
              column: col,
              cardIds: list,
            });
            setPreference("pulseLayout", next);
            const title = CARD_TITLES[cardId as PulseCardId] || cardId;
            setAnnouncement(
              `Moved ${title} to position ${targetIdx + 1} of ${list.length}`,
            );
          }
          break;
        }
      }
    },
    [preferences?.pulseLayout, setPreference],
  );

  const handleResetLayout = useCallback(() => {
    const previous = preferences?.pulseLayout;
    setPreference(
      "pulseLayout",
      pulseLayoutReducer(previous ?? DEFAULT_PULSE_LAYOUT, { type: "reset" }),
    );
    toast.success(
      "Layout reset to default",
      previous
        ? withUndo(() => setPreference("pulseLayout", previous))
        : undefined,
    );
  }, [preferences?.pulseLayout, setPreference]);

  // One write per drag. The drag's own live region announces the drop.
  const handleDrop = useCallback(
    (action: PulseLayoutAction) => {
      const raw = preferences?.pulseLayout ?? DEFAULT_PULSE_LAYOUT;
      setPreference("pulseLayout", pulseLayoutReducer(raw, action));
    },
    [preferences?.pulseLayout, setPreference],
  );

  useEffect(() => {
    const target = refocusRef.current;
    if (!target) return;
    refocusRef.current = null;
    target()?.focus();
  }, [resolvedLayout]);

  const contactsMap = useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl?: string | null }>();
    for (const c of contacts) {
      map.set(c.id, { name: c.name, avatarUrl: c.avatarUrl });
    }
    return map;
  }, [contacts]);

  // The ring's data by contact id: an action item carries none of it.
  const contactScores = useMemo(() => {
    const map = new Map<
      string,
      {
        isTracked: boolean;
        relationshipScore: number | null;
        lastContactedAt: string | null;
      }
    >();
    for (const c of contacts) {
      map.set(c.id, {
        isTracked: c.isTracked,
        relationshipScore: c.relationshipScore ?? null,
        lastContactedAt: c.lastContactedAt ?? null,
      });
    }
    return map;
  }, [contacts]);

  const upcomingBirthdays = useMemo(() => {
    return getUpcomingBirthdays(contacts, new Date(), 14);
  }, [contacts]);

  // People added in the last 30 days, and how many are untracked. The
  // untracked count uses the server's exclusions: a ghost is a mention.
  const newPeople = useMemo(() => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let untracked = 0;
    for (const c of contacts) {
      if (c.isGhost || c.isTracked || !c.addedAt) continue;
      const added = new Date(c.addedAt).getTime();
      if (!Number.isNaN(added) && added >= since) untracked++;
    }
    return { total: dashboard?.metrics.newContacts30d ?? 0, untracked };
  }, [contacts, dashboard?.metrics.newContacts30d]);

  const upNext = useMemo(() => {
    if (!dashboard) {
      return buildUpNextQueue({});
    }
    const open = <T extends { id: string }>(items: T[]) =>
      items.filter((item) => !hiddenIds.has(item.id));
    return buildUpNextQueue({
      overdue: open(dashboard.overdue),
      dueToday: open(dashboard.dueToday),
      upcoming: open(dashboard.upcoming),
      birthdays: upcomingBirthdays,
      catchUp: dashboard.catchUp,
      catchUpCount: dashboard.tracking.catchUpCount,
      contactScores,
    });
  }, [dashboard, upcomingBirthdays, contactScores, hiddenIds]);

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  // Whether the selected row shows its tint. See UpNextCard.
  const [selectionShown, setSelectionShown] = useState(false);
  const selectionShownRef = useRef(selectionShown);
  selectionShownRef.current = selectionShown;
  const prevItemsRef = useRef(upNext.items);

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

  // Speaks only once the selection shows, so a page load says nothing.
  const [liveStatus, setLiveStatus] = useState("");
  useEffect(() => {
    if (highlightedItem && selectionShown) {
      setLiveStatus(
        `Row ${selectedIndex + 1} of ${upNext.items.length}, ${highlightedItem.contactName}, ${highlightedItem.dueChip.text.toLowerCase()}`,
      );
    } else {
      setLiveStatus("");
    }
  }, [selectedIndex, highlightedItem, upNext.items.length, selectionShown]);

  const highlightedItemRef = useRef(highlightedItem);
  highlightedItemRef.current = highlightedItem;
  const itemsCountRef = useRef(upNext.items.length);
  itemsCountRef.current = upNext.items.length;

  // J / K / D / S / L / C. Enter is not here: it belongs to the focused
  // control, and a focused row opens its contact itself (ActionRow).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A key in a field, a dialog or a menu is theirs, so D in the Snooze
      // menu does not complete the row behind it.
      if (isPageKeyTaken(e)) return;
      if (draggingRef.current) return;

      const item = highlightedItemRef.current;

      if (!singleKey) return;

      const key = e.key.toLowerCase();

      // While no row shows the selection, the first queue key only shows
      // it, so D never completes a row nobody can see.
      if (QUEUE_KEYS.has(key) && !selectionShownRef.current) {
        e.preventDefault();
        setSelectionShown(true);
        return;
      }

      if (key === "c") {
        e.preventDefault();
        handleToggleCustomize();
      } else if (key === "j") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < itemsCountRef.current - 1 ? prev + 1 : prev,
        );
      } else if (key === "k") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (key === "d") {
        if (item?.hasCheckAction) {
          e.preventDefault();
          handleComplete(item.id);
        }
      } else if (key === "s") {
        if (item?.hasCheckAction) {
          e.preventDefault();
          handleSnooze(item, 1);
        }
      } else if (key === "l") {
        if (item) {
          e.preventDefault();
          openQuickNote(item.contactId);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [singleKey, handleComplete, handleSnooze, handleToggleCustomize]);

  const upNextCardRef = useRef<HTMLDivElement>(null);

  // A masthead count jumps to its group in the queue. A missing group falls
  // back to its card: Up next, or Coming up for a later birthday.
  const handleJumpTo = useCallback((target: JumpTarget) => {
    if (jumpToGroup(target)) return;
    const card =
      target === "birthdays"
        ? document.querySelector('[data-card-id="coming-up"]')
        : upNextCardRef.current;
    card?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
  }, []);

  const handleOpenContact = useCallback(
    (contactId: string) => navigate(`/contact/${contactId}`),
    [navigate],
  );

  // Each card's element is memoized on its data, so customize mode or a drag
  // step renders the grid but skips the cards: React skips a seen element.
  const upNextCard = useMemo(
    () => (
      <div ref={upNextCardRef}>
        <UpNextCard
          items={upNext.items}
          groups={upNext.groups}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          selectionShown={selectionShown}
          onSelectionShownChange={setSelectionShown}
          onComplete={handleComplete}
          onSnooze={handleSnooze}
          onLog={logNote}
          onOpenContact={handleOpenContact}
        />
      </div>
    ),
    [
      upNext.items,
      upNext.groups,
      selectedIndex,
      selectionShown,
      handleComplete,
      handleSnooze,
      handleOpenContact,
    ],
  );
  const completedCard = useMemo(() => <CompletedCard />, []);
  const activityCard = useMemo(
    () => <ActivityCard activity={activity} />,
    [activity],
  );
  const tracking = dashboard?.tracking;
  const keepingUpCard = useMemo(
    () => <KeepingUpCard tracking={tracking} />,
    [tracking],
  );
  const compositionCard = useMemo(
    () => <CompositionCard dashboard={dashboard} />,
    [dashboard],
  );
  const insightCard = useMemo(
    () => (
      <InsightCard
        insight={insight}
        isLoading={isInsightLoading}
        aiAllowed={aiAllowed}
        onRetry={() => void refetchInsight()}
      />
    ),
    [insight, isInsightLoading, aiAllowed, refetchInsight],
  );
  const ghosts = dashboard?.ghosts;
  const hygiene = dashboard?.hygiene;
  const correspondents = dashboard?.correspondents ?? 0;
  const inboxCard = useMemo(
    () => (
      <InboxCard
        pendingDuplicates={pendingSuggestions}
        ghosts={ghosts ?? []}
        hygiene={hygiene}
        correspondents={correspondents}
        newPeople={newPeople}
      />
    ),
    [pendingSuggestions, ghosts, hygiene, correspondents, newPeople],
  );
  const meetings = dashboard?.meetings;
  const comingUpCard = useMemo(
    () => (
      <ComingUpCard
        birthdays={upcomingBirthdays}
        meetings={meetings ?? []}
        contactsMap={contactsMap}
      />
    ),
    [upcomingBirthdays, meetings, contactsMap],
  );
  const cardElements = useMemo<Record<PulseCardId, React.ReactNode>>(
    () => ({
      "up-next": upNextCard,
      completed: completedCard,
      activity: activityCard,
      "keeping-up": keepingUpCard,
      composition: compositionCard,
      insight: insightCard,
      inbox: inboxCard,
      "coming-up": comingUpCard,
    }),
    [
      upNextCard,
      completedCard,
      activityCard,
      keepingUpCard,
      compositionCard,
      insightCard,
      inboxCard,
      comingUpCard,
    ],
  );

  // A failed background refetch keeps the data on screen, with `isError` set.
  if (isError && !dashboard) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <LoadFailed
          what="Pulse"
          body="Check that the server is running, then try again"
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (isDashboardLoading || !dashboard) {
    // The skeleton sizes the insight card to its text once it is back.
    // `null` (AI off, or an empty insight) draws the one-line shape.
    return (
      <PulseSkeleton
        insight={
          !aiAllowed || (!isInsightLoading && !insight) ? null : insight?.text
        }
      />
    );
  }

  const isZeroContacts = dashboard.metrics.totalActive === 0;

  return (
    <div className="w-full h-full overflow-y-auto bg-surface relative">
      <div role="status" aria-live="polite" className="sr-only">
        {liveStatus}
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div
        className={cn(
          "max-w-[1600px] mx-auto flex flex-col gap-6 sm:gap-8 pb-32",
          PAGE_X,
          PAGE_TOP,
        )}
      >
        <Masthead
          counts={{
            overdue: upNext.counts.overdue,
            dueToday: upNext.counts.today,
            birthdaysThisWeek: upNext.counts.birthdays,
            queued: upNext.counts.total,
            streak: activity?.streak.current ?? 0,
          }}
          isEditing={isEditing}
          onToggleCustomize={handleToggleCustomize}
          onJumpTo={handleJumpTo}
          quiet={isZeroContacts}
          moreRef={moreRef}
        />

        {/* Sticky at the top, not the bottom, where the Undo toast of a
            hidden card covers Reset layout and Done. */}
        {isEditing && (
          <div
            role="region"
            aria-label="Layout customize actions"
            className="tile-enter sticky top-2 z-30 self-center w-fit max-w-full px-5 py-3 rounded-2xl bg-surface-container-highest/95 backdrop-blur-md shadow-lg border border-outline-variant flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
          >
            <p className="text-xs sm:text-sm text-on-surface text-center sm:text-left">
              <span className="font-semibold">Editing layout</span>
              <span className="text-on-surface-variant">
                {" · "}
                <span>
                  Move a card by its handle or its Move menu. Use the eye to
                  hide one
                </span>
              </span>
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleResetLayout}
                className="btn-secondary btn-sm"
              >
                Reset layout
              </button>
              <button
                type="button"
                onClick={handleDone}
                className="btn-primary btn-sm"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {isEditing && resolvedLayout.hidden.length > 0 && (
          <section
            aria-label="Hidden cards"
            data-testid="hidden-cards-tray"
            className="rounded-2xl bg-surface-container/60 p-4 sm:p-5 flex flex-col gap-3 transition-all"
          >
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-on-surface-variant" />
              <h2 className="text-sm font-bold text-on-surface">
                Hidden cards
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-surface-container-highest text-on-surface-variant tabular-nums">
                {resolvedLayout.hidden.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {resolvedLayout.hidden.map((cardId) => {
                const title = CARD_TITLES[cardId] || cardId;
                const defaultCol = getDefaultColumnForCard(cardId);
                return (
                  <div
                    key={cardId}
                    data-card-id={cardId}
                    className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl bg-surface-container-high text-xs sm:text-sm font-medium text-on-surface"
                  >
                    <span>{title}</span>
                    <button
                      type="button"
                      onClick={() => handleShowCard(cardId)}
                      aria-label={`Show ${title}`}
                      title={`Restore ${title} to ${COLUMN_NAMES[defaultCol]}`}
                      className="hit-area state-layer p-1 rounded-lg text-primary cursor-pointer"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {isZeroContacts ? (
          <WelcomeOffice />
        ) : (
          <PulseGrid
            layout={resolvedLayout.visible}
            isEditing={isEditing}
            cards={cardElements}
            onHide={handleHideCard}
            onMoveToColumn={handleMoveToColumn}
            onMoveStep={handleMoveStep}
            onDrop={handleDrop}
            draggingRef={draggingRef}
          />
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
      {/* No Suspense here: the app's page boundary (`App.tsx`) keeps Pulse
          on screen while the code loads, with no blank flash. */}
      <Route path="duplicates" element={<DuplicatesPage />} />
      <Route
        path="suggestions"
        element={<Navigate to="/pulse/duplicates" replace />}
      />
      <Route path="*" element={<PulseOffice />} />
    </Routes>
  );
};
