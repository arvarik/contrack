import React, { useState, useRef, useEffect, memo } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  HeartPulse,
  Cake,
  Clock,
  CalendarDays,
  Calendar,
} from "lucide-react";
import { addDays } from "date-fns";
import { cn } from "../../../lib/utils";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
import { useUpdateActionItem } from "../../../api";
import { formatRelative } from "../../../lib/datetime";
import { SELECTED_ROW, TONE_TEXT, TONE_WASH } from "../../../lib/styles";
import {
  CHECK_RING_REST,
  DUE_TONE,
  GROUP_TONE,
  PULSE_CHIP,
  PULSE_TYPE,
} from "../lib/pulseStyles";
import type { UpNextItem } from "../lib/upNext";

export interface ActionRowProps {
  item: UpNextItem;
  /**
   * The row is the list's current row: `aria-current` and the one tab stop.
   * It does not paint the row. See `looksSelected`.
   */
  isSelected?: boolean;
  /** The row wears the selected tint. The queue paints it for the keyboard only. */
  looksSelected?: boolean;
  onSelect?: () => void;
  onComplete?: (id: string) => void;
  onLog?: (contactId: string) => void;
  onOpenContact?: (contactId: string) => void;
  /**
   * ArrowDown and ArrowUp on the focused row move the highlight. The card
   * passes a function that steps the index within bounds.
   */
  onMove?: (direction: -1 | 1) => void;
  /**
   * True while focus is inside the list. A row that becomes selected while
   * focus is inside the list takes focus, so the arrows walk the rows. A row
   * that becomes selected from a bare J or K with focus elsewhere only
   * scrolls into view, so a key press never yanks focus off a control.
   */
  focusOnSelect?: boolean;
  /**
   * The phone anatomy, below `sm`. The name takes line one with the snooze
   * at its end, the title may run to two lines, and the chip moves down to a
   * meta line beside "Last spoke". On a 390 px phone a row has about 220 px
   * for text, and a name, a chip and a button do not share that width.
   */
  compact?: boolean;
}

/**
 * The leading glyph's circle: 24 px on screen with a 44 px tap box, and the
 * hover layer rather than a fill, so the glyph keeps its group's colour.
 */
const GLYPH =
  "hit-area state-layer w-6 h-6 rounded-full flex items-center justify-center shrink-0 cursor-pointer";

/** The snooze choices. Each one moves the due date that many days out. */
const SNOOZE_PRESETS = [
  { id: "tomorrow", label: "Tomorrow", days: 1, icon: Clock },
  { id: "three-days", label: "In 3 days", days: 3, icon: CalendarDays },
  { id: "next-week", label: "Next week", days: 7, icon: Calendar },
  { id: "next-month", label: "Next month", days: 30, icon: Calendar },
] as const;

/** True when the click started on a control inside the row. */
const onControl = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("a, button, [role='menu'], [role='menuitem']") !== null;

/**
 * One row of the Up next queue.
 *
 * Two lines with a free right edge. Line one is the name and the chip, and
 * it wraps on a phone so the name is never cut. Line two is the title. Under
 * them, when the row knows it, "Last spoke 12 days ago". A click or a tap
 * anywhere on the row opens the contact, the same as Enter, so the row does
 * what a list row does everywhere else in the app and a tap on a phone is
 * not a dead gesture. A click that starts on a control inside the row (the
 * check, the Log button, the name, the snooze menu) belongs to that control.
 *
 * The one action at the right, snooze, is the shared `ActionMenu`. From `sm`
 * it floats over the row's right edge on a wash and shows on hover or focus,
 * so at rest the text has the whole width. Below `sm` there is no hover, so
 * it sits in the flow at the row's end as a 44 px target. A birthday or a
 * catch-up row has no snooze: there is no date to move.
 *
 * The row is the one roving tab stop of the list: `tabIndex` is 0 on the
 * highlighted row and -1 elsewhere. Enter opens the contact, Space does the
 * row's primary action, ArrowDown and ArrowUp move the highlight. Each key
 * is claimed only when the event target is the row itself, so a button
 * inside the row keeps its own Enter and Space. The row keeps
 * `role="listitem"`: it is a clickable element with a keyboard equivalent,
 * not a button. Focus that enters the row, on the row or on a control in
 * it, makes it the current row. Being current and looking selected are two
 * props: the queue paints the tint only while the keyboard is on the list.
 */
export const ActionRow = memo(
  ({
    item,
    isSelected = false,
    looksSelected = false,
    onSelect,
    onComplete,
    onLog,
    onOpenContact,
    onMove,
    focusOnSelect = false,
    compact = false,
  }: ActionRowProps) => {
    const [isCompleting, setIsCompleting] = useState(false);
    const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const wasSelectedRef = useRef(isSelected);
    const updateAction = useUpdateActionItem();

    useEffect(() => {
      return () => {
        if (completeTimerRef.current) {
          clearTimeout(completeTimerRef.current);
        }
      };
    }, []);

    // When the highlight arrives on this row, bring it into view. It takes
    // focus too when focus was already inside the list, so the arrows and
    // J or K pressed on a row keep walking rows. Focus that is already in
    // the row stays where it is: Tab onto the row's check makes the row
    // current, and the row must not take focus back from the check. The
    // first render is not an arrival: the page must not scroll to the
    // queue on load.
    useEffect(() => {
      const arrived = isSelected && !wasSelectedRef.current;
      wasSelectedRef.current = isSelected;
      if (!arrived) return;
      const el = rowRef.current;
      if (!el) return;
      // jsdom has no scrollIntoView, so the call is optional.
      el.scrollIntoView?.({ block: "nearest" });
      if (focusOnSelect && !el.contains(document.activeElement)) {
        el.focus({ preventScroll: true });
      }
    }, [isSelected, focusOnSelect]);

    const complete = () => {
      if (isCompleting) return;
      setIsCompleting(true);
      completeTimerRef.current = setTimeout(() => {
        onComplete?.(item.id);
      }, 280);
    };

    const handleComplete = (e: React.MouseEvent) => {
      e.stopPropagation();
      complete();
    };

    const handleLog = (e: React.MouseEvent) => {
      e.stopPropagation();
      onLog?.(item.contactId);
    };

    const handleRowClick = (e: React.MouseEvent) => {
      if (onControl(e.target)) return;
      onSelect?.();
      onOpenContact?.(item.contactId);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      // A control inside the row keeps its own keys.
      if (e.target !== e.currentTarget) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "Enter":
          e.preventDefault();
          onOpenContact?.(item.contactId);
          return;
        case " ":
          e.preventDefault();
          if (item.hasCheckAction) complete();
          else onLog?.(item.contactId);
          return;
        case "ArrowDown":
          e.preventDefault();
          onMove?.(1);
          return;
        case "ArrowUp":
          e.preventDefault();
          onMove?.(-1);
          return;
        default:
          return;
      }
    };

    const snoozeItems: ActionMenuItem[] = SNOOZE_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      icon: preset.icon,
      onSelect: () =>
        updateAction.mutate({
          id: item.id,
          data: { dueAt: addDays(new Date(), preset.days).toISOString() },
        }),
    }));

    // A catch-up's chip already says how long it has been, so the row does
    // not say it twice.
    const lastSpoke =
      item.kind !== "catch-up" && item.lastContactedAt
        ? formatRelative(item.lastContactedAt)
        : null;

    // The chip's tone says how soon the row is due. The leading glyph's tone
    // is its group's, the same as the dot beside the group's name.
    const chip = (
      <span
        className={cn(PULSE_CHIP, TONE_WASH[DUE_TONE[item.dueChip.variant]])}
      >
        {item.dueChip.text}
      </span>
    );
    const tone = GROUP_TONE[item.group];

    // The one action. On a phone it ends line one and is always visible,
    // and its negative margin keeps the 32 px glyph from making line one
    // taller than the name, so a row with a snooze has the same rhythm as
    // a row without one. From sm it floats over the row's right edge and
    // shows on hover or focus, so at rest the text has the whole width.
    const snooze = item.hasCheckAction ? (
      <ActionMenu
        label="Snooze item"
        title="Snooze"
        heading="Snooze until"
        icon={Clock}
        iconClassName="w-4 h-4"
        items={snoozeItems}
        className={cn(
          "shrink-0",
          compact
            ? "ml-auto"
            : "absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-surface-container-low/95 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        triggerClassName={compact ? "-my-1.5" : "p-1 rounded-lg"}
      />
    ) : null;

    return (
      // The row is a list item with a roving tab stop and its own keys, on
      // purpose: see the component comment. The two rules disabled here would
      // ask for role="button", which would take the list semantics away.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        ref={rowRef}
        role="listitem"
        aria-current={isSelected ? "true" : undefined}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={isSelected ? 0 : -1}
        // Focus on the row, or on a control inside it, makes the row the
        // current one, the row J and K move. Tab walks the controls of
        // every row, and the tint used to stay behind on the first.
        onFocus={() => {
          if (!isSelected) onSelect?.();
        }}
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        className={cn(
          // The resting wash, or the selected row's tint, with the
          // hover layer over either one.
          "state-layer group relative w-full flex items-center rounded-xl py-2.5 transition-colors cursor-pointer",
          compact ? "gap-2.5 px-2.5" : "gap-3 px-3",
          looksSelected ? SELECTED_ROW : "bg-surface-container-low/70",
          isCompleting && "opacity-50",
        )}
      >
        {/* The primary action: the check for a follow-up, Log for a
            birthday or a catch-up, in the group's tone. The check's ring
            is a step under full ink at rest, and full on hover and while
            it completes. */}
        {item.hasCheckAction ? (
          <button
            type="button"
            onClick={handleComplete}
            disabled={isCompleting}
            aria-label={`Mark "${item.title}" done`}
            className={cn(
              GLYPH,
              "border-2 transition-all duration-(--dur-fast)",
              // Done is the success tone: its wash and its own ink, which
              // clear AA where white on a raw green did not.
              isCompleting
                ? cn(TONE_WASH.success, "border-success scale-110")
                : cn(TONE_TEXT[tone], CHECK_RING_REST, "hover:border-current"),
            )}
          >
            <Check
              className={cn(
                "w-3.5 h-3.5 transition-opacity",
                isCompleting
                  ? "opacity-100"
                  : "opacity-40 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            />
          </button>
        ) : item.kind === "birthday" ? (
          <button
            type="button"
            onClick={handleLog}
            title="Log a birthday note"
            aria-label={`Wish ${item.contactName} a happy birthday`}
            className={cn(GLYPH, TONE_WASH[tone])}
          >
            <Cake className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleLog}
            title="Log an interaction"
            aria-label={`Log note for ${item.contactName}`}
            className={cn(GLYPH, TONE_WASH[tone])}
          >
            <HeartPulse className="w-3.5 h-3.5" />
          </button>
        )}

        <div className="shrink-0">
          <ScoreRingAvatar
            contact={{
              name: item.contactName,
              avatarUrl: item.contactAvatarUrl,
              isTracked: item.isTracked,
              relationshipScore: item.relationshipScore,
              lastContactedAt: item.lastContactedAt,
            }}
            size={36}
          />
        </div>

        {/* The text block takes the whole width. From sm, line one is the
            name and the chip, and it wraps so a long name pushes the chip
            under it instead of losing its letters. The snooze floats over the
            row's right edge on a wash and shows on hover or focus. On a phone
            the snooze ends line one as a 32 px glyph with a 44 px tap box,
            the title may run to two lines, and the chip joins "Last spoke"
            on a meta line. */}
        <div className="flex flex-col flex-1 min-w-0 gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              to={`/contact/${item.contactId}`}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                PULSE_TYPE.name,
                "hit-area inline-flex hover:text-primary transition-colors",
                // The second cue beside the tint, as on a Network row: the
                // tint alone sits about 1.06 to 1 against the resting wash.
                looksSelected && "text-on-primary-wash",
              )}
            >
              {item.contactName}
            </Link>
            {!compact && chip}
            {snooze}
          </div>

          <span
            className={cn(
              PULSE_TYPE.rowTitle,
              compact ? "line-clamp-2" : "line-clamp-1",
              "transition-all",
              isCompleting && "line-through opacity-50",
            )}
          >
            {item.title}
          </span>

          {(compact || lastSpoke) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {compact && chip}
              {lastSpoke && (
                <span className={PULSE_TYPE.meta}>Last spoke {lastSpoke}</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);
