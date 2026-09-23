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
import { HeartPulse, Eye, EyeOff } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
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
import { PAGE_TOP, PAGE_X } from "../../lib/styles";
import { EmptyState } from "../../components/ui/EmptyState";
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
} from "./lib/layout";
import { buildUpNextQueue, computeNextHighlightIndex } from "./lib/upNext";
import { getUpcomingBirthdays } from "./lib/birthdays";
import { jumpToGroup } from "./lib/jumpToGroup";
import { COLUMN_CLASSES, GRID_CLASSES } from "./lib/pulseStyles";
import { Masthead, type JumpTarget } from "./components/Masthead";
import { PulseSkeleton } from "./components/PulseSkeleton";
import { WelcomeOffice } from "./components/WelcomeOffice";
import { SortableCard } from "./components/SortableCard";
import { UpNextCard } from "./cards/UpNextCard";
import { CompletedCard } from "./cards/CompletedCard";
import { InsightCard } from "./cards/InsightCard";
import { InboxCard } from "./cards/InboxCard";
import { ComingUpCard } from "./cards/ComingUpCard";
import { ActivityCard } from "./cards/ActivityCard";
import { KeepingUpCard } from "./cards/KeepingUpCard";
import { CompositionCard } from "./cards/CompositionCard";

const DuplicatesPage = React.lazy(() =>
  import("./pages/DuplicatesPage").then((m) => ({ default: m.DuplicatesPage })),
);

/** The single keys that walk or act on the selected Up next row. */
const QUEUE_KEYS = new Set(["j", "k", "d", "s", "l"]);

interface DroppableColumnProps {
  id: PulseColumn;
  cards: PulseCardId[];
  isEditing: boolean;
  renderCard: (
    cardId: PulseCardId,
    index: number,
    total: number,
  ) => React.ReactNode;
}

/**
 * One column of the grid. Its classes come from `COLUMN_CLASSES`, which the
 * skeleton and the route fallback read too. The sortable strategy is the
 * rect one because the Intelligence column is a vertical list at `xl` and a
 * two-across grid at `lg`, and `rectSortingStrategy` sorts both.
 */
const DroppableColumn = ({
  id,
  cards,
  isEditing,
  renderCard,
}: DroppableColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${id}`,
    disabled: !isEditing,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-6 transition-colors rounded-2xl p-1",
        isOver && "bg-primary/5 ring-2 ring-primary/30",
        COLUMN_CLASSES[id],
      )}
    >
      <SortableContext items={cards} strategy={rectSortingStrategy}>
        {cards.map((cardId, index) => renderCard(cardId, index, cards.length))}
        {cards.length === 0 && isEditing && (
          <div className="p-8 rounded-2xl border-2 border-dashed border-outline-variant text-center text-xs text-on-surface-variant font-medium">
            Drop cards here
          </div>
        )}
      </SortableContext>
    </div>
  );
};

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

  const { preferences, setPreference } = usePreferences();
  const singleKey = useSingleKeyShortcuts();

  const completeAction = useCompleteActionItem();
  const updateAction = useUpdateActionItem();

  // Customize mode state
  const [isEditing, setIsEditing] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const handleToggleCustomize = useCallback(() => {
    setIsEditing((prev) => {
      const next = !prev;
      setAnnouncement(next ? "Layout editing on" : "Layout editing off");
      return next;
    });
  }, []);

  const handleDone = useCallback(() => {
    setIsEditing(false);
    setAnnouncement("Layout editing off");
  }, []);

  // Layout resolution
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
    const raw = preferences?.pulseLayout ?? DEFAULT_PULSE_LAYOUT;
    const next = pulseLayoutReducer(raw, { type: "reset" });
    setPreference("pulseLayout", next);
    setAnnouncement("Layout reset to default");
  }, [preferences?.pulseLayout, setPreference]);

  // @dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      const raw = preferences?.pulseLayout ?? DEFAULT_PULSE_LAYOUT;
      const resolved = resolveLayout(raw);

      // Find source column
      let sourceCol: PulseColumn | null = null;
      for (const col of PULSE_COLUMNS) {
        if (resolved.visible[col].includes(activeId as PulseCardId)) {
          sourceCol = col;
          break;
        }
      }
      if (!sourceCol) return;

      // Find target column and target index
      let targetCol: PulseColumn | null = null;
      let targetIndex = 0;

      if (overId.startsWith("column-")) {
        targetCol = overId.replace("column-", "") as PulseColumn;
        targetIndex = resolved.visible[targetCol].length;
      } else {
        for (const col of PULSE_COLUMNS) {
          const idx = resolved.visible[col].indexOf(overId as PulseCardId);
          if (idx !== -1) {
            targetCol = col;
            targetIndex = idx;
            break;
          }
        }
      }

      if (!targetCol) return;

      if (sourceCol === targetCol) {
        const colCards = [...resolved.visible[sourceCol]];
        const fromIdx = colCards.indexOf(activeId as PulseCardId);
        const toIdx = targetIndex;
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const reordered = arrayMove(colCards, fromIdx, toIdx);
          const next = pulseLayoutReducer(raw, {
            type: "reorder",
            column: sourceCol,
            cardIds: reordered,
          });
          setPreference("pulseLayout", next);
          const title = CARD_TITLES[activeId as PulseCardId] || activeId;
          setAnnouncement(`Moved ${title} to position ${toIdx + 1}`);
        }
      } else {
        const next = pulseLayoutReducer(raw, {
          type: "move",
          cardId: activeId,
          targetColumn: targetCol,
          targetIndex,
        });
        setPreference("pulseLayout", next);
        const title = CARD_TITLES[activeId as PulseCardId] || activeId;
        setAnnouncement(`Moved ${title} to ${COLUMN_NAMES[targetCol]}`);
      }
    },
    [preferences?.pulseLayout, setPreference],
  );

  // Map of contacts for fast lookup (e.g. meeting attendee avatars)
  const contactsMap = useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl?: string | null }>();
    for (const c of contacts) {
      map.set(c.id, { name: c.name, avatarUrl: c.avatarUrl });
    }
    return map;
  }, [contacts]);

  // What every row's ring needs, by contact id. The slim cache carries the
  // flag, the score and the date, and an action item carries none of them.
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

  // Compute upcoming birthdays within 14 days client-side
  const upcomingBirthdays = useMemo(() => {
    return getUpcomingBirthdays(contacts, new Date(), 14);
  }, [contacts]);

  // The Inbox's tracking row: the people added in the last 30 days, and how
  // many of them nobody tracks yet. The total is the server's count and the
  // untracked count is read off the slim rows, with the same exclusions the
  // server applies (a ghost is a mention, not a person to track).
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
      catchUp: dashboard.catchUp,
      catchUpCount: dashboard.tracking.catchUpCount,
      contactScores,
    });
  }, [dashboard, upcomingBirthdays, contactScores]);

  // Selected index in Up Next
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  // Whether the selected row wears its tint: from the first queue key, or
  // while keyboard focus is in the list, until focus leaves the list or a
  // pointer presses outside it. See UpNextCard.
  const [selectionShown, setSelectionShown] = useState(false);
  const selectionShownRef = useRef(selectionShown);
  selectionShownRef.current = selectionShown;
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

  // Screen reader announcement for keyboard navigation. It speaks only once
  // the selection shows, from the first queue key or keyboard focus in the
  // list: "Row 1 of 8" on load was the spoken form of the stray tint.
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

  // Keyboard navigation (J / K / D / S / L / C). Enter is not here: it
  // belongs to the control that has focus. A focused row opens its contact
  // from its own handler (ActionRow), and a button, a link or a menu item
  // keeps its own Enter. A window-level Enter used to open the highlighted
  // contact from anywhere on the page, the Customize button included.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A key pressed in a dialog belongs to the dialog: D on a button in
      // the Log note dialog would complete the queue's row behind it.
      if (e.target instanceof Element && e.target.closest('[role="dialog"]'))
        return;

      const item = highlightedItemRef.current;

      // Single-key shortcuts respect preference
      if (!singleKey) return;

      const key = e.key.toLowerCase();

      // J, K, D, S and L walk or act on the selected row. While no row
      // shows it, the first of them only shows the row and does nothing
      // else: D on a row nobody can see completed it unseen.
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
          completeAction.mutate(item.id);
        }
      } else if (key === "s") {
        if (item?.hasCheckAction) {
          e.preventDefault();
          updateAction.mutate({
            id: item.id,
            data: { dueAt: addDays(new Date(), 1).toISOString() },
          });
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
  }, [singleKey, completeAction, updateAction, handleToggleCustomize]);

  const upNextCardRef = useRef<HTMLDivElement>(null);

  // A count in the masthead's sentence jumps to its group heading inside
  // the queue: Overdue, Today or Birthdays (`jumpToGroup`). A group that is
  // not there falls back to its card: Up next, or Coming up for a birthday
  // further out.
  const handleJumpTo = useCallback((target: JumpTarget) => {
    if (jumpToGroup(target)) return;
    const card =
      target === "birthdays"
        ? document.querySelector('[data-card-id="coming-up"]')
        : upNextCardRef.current;
    card?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);

  // Render individual cards by cardId
  const renderCardContent = (cardId: PulseCardId) => {
    switch (cardId) {
      case "up-next":
        return (
          <div ref={upNextCardRef}>
            <UpNextCard
              items={upNext.items}
              groups={upNext.groups}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              selectionShown={selectionShown}
              onSelectionShownChange={setSelectionShown}
              onComplete={(id) => completeAction.mutate(id)}
              onLog={(cid) => openQuickNote(cid)}
              onOpenContact={(cid) => navigate(`/contact/${cid}`)}
            />
          </div>
        );
      case "completed":
        return <CompletedCard />;
      case "activity":
        return <ActivityCard activity={activity} />;
      case "keeping-up":
        return <KeepingUpCard tracking={dashboard?.tracking} />;
      case "composition":
        return <CompositionCard dashboard={dashboard} />;
      case "insight":
        return (
          <InsightCard
            insight={insight}
            isLoading={isInsightLoading}
            aiAllowed={aiAllowed}
          />
        );
      case "inbox":
        return (
          <InboxCard
            pendingDuplicates={pendingSuggestions}
            ghosts={dashboard?.ghosts ?? []}
            hygiene={dashboard?.hygiene}
            correspondents={dashboard?.correspondents ?? 0}
            newPeople={newPeople}
          />
        );
      case "coming-up":
        return (
          <ComingUpCard
            birthdays={upcomingBirthdays}
            meetings={dashboard?.meetings ?? []}
            contactsMap={contactsMap}
          />
        );
      default:
        return null;
    }
  };

  const renderSortableCard = (
    cardId: PulseCardId,
    index: number,
    total: number,
    column: PulseColumn,
  ) => {
    return (
      <SortableCard
        key={cardId}
        cardId={cardId}
        column={column}
        index={index}
        totalInColumn={total}
        isEditing={isEditing}
        onHide={handleHideCard}
        onMoveToColumn={handleMoveToColumn}
        onMoveStep={handleMoveStep}
      >
        {renderCardContent(cardId)}
      </SortableCard>
    );
  };

  if (isError) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <EmptyState
          icon={HeartPulse}
          tone="error"
          title="System disconnected"
          body="Failed to load the relationship pulse dashboard."
        />
      </div>
    );
  }

  if (isDashboardLoading || !dashboard) {
    // The insight loads beside the dashboard. The skeleton draws its card
    // at the height of its words once they are back, and at the height of
    // an insight of a common length before that. It draws the line only
    // when there is no insight to draw: AI is off, or it came back empty.
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
      {/* Screen reader live announcements */}
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
        {/* The masthead: the title and the day, the sentence, the actions */}
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
        />

        {/* Hidden Cards Tray in Customize Mode, only when a card is hidden */}
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

        {/* Content: Welcome Office if 0 contacts, else 3-column Grid with DndContext */}
        {isZeroContacts ? (
          <WelcomeOffice />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <div className={GRID_CLASSES}>
              {/* Column 1: Focus (Up next, Completed) */}
              <DroppableColumn
                id="focus"
                cards={resolvedLayout.visible.focus}
                isEditing={isEditing}
                renderCard={(cardId, index, total) =>
                  renderSortableCard(cardId, index, total, "focus")
                }
              />

              {/* Column 2: Intelligence (Insight, Inbox, Coming up, Composition) */}
              <DroppableColumn
                id="intel"
                cards={resolvedLayout.visible.intel}
                isEditing={isEditing}
                renderCard={(cardId, index, total) =>
                  renderSortableCard(cardId, index, total, "intel")
                }
              />

              {/* Column 3: Network (Keeping up, Activity) */}
              <DroppableColumn
                id="network"
                cards={resolvedLayout.visible.network}
                isEditing={isEditing}
                renderCard={(cardId, index, total) =>
                  renderSortableCard(cardId, index, total, "network")
                }
              />
            </div>
          </DndContext>
        )}

        {/* Floating Bottom Bar in Customize Mode */}
        {isEditing && (
          <div
            role="region"
            aria-label="Layout customize actions"
            className="tile-enter fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 left-4 right-4 mx-auto z-[60] w-fit px-5 py-3 rounded-2xl bg-surface-container-highest/95 backdrop-blur-md shadow-2xl border border-outline-variant flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
          >
            {/* Anchored on both sides and centred with auto margins, so the
                bar sizes itself against the whole width. At left 50% a fixed
                box measures against the half that is left and squeezes its
                buttons onto two lines on a phone. One sentence that wraps:
                on a phone it takes the first lines and the two buttons the
                last. The words follow the controls a person has at that
                width. */}
            <p className="text-xs sm:text-sm text-on-surface text-center sm:text-left">
              <span className="font-semibold">Editing layout</span>
              <span className="text-on-surface-variant">
                {" · "}
                <span className="hidden sm:inline">
                  Drag a card to move it. Use the eye to hide one.
                </span>
                <span className="sm:hidden">
                  Use the arrows to move a card and the eye to hide one.
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
