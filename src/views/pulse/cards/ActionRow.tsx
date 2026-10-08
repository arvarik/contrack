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
import { cn } from "../../../lib/utils";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../../components/ui/ActionMenu";
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

interface ActionRowProps {
  item: UpNextItem;
  /** The current row: `aria-current` and the one tab stop. Not the tint. */
  isSelected?: boolean;
  /** The row wears the selected tint. The queue paints it for the keyboard only. */
  looksSelected?: boolean;
  onSelect?: () => void;
  onComplete?: (id: string) => void;
  /** Move a follow-up's due date out by some days. */
  onSnooze?: (item: UpNextItem, days: number) => void;
  onLog?: (contactId: string) => void;
  onOpenContact?: (contactId: string) => void;
  /** ArrowDown and ArrowUp on the focused row move the highlight. */
  onMove?: (direction: -1 | 1) => void;
  /**
   * True while focus is inside the list. A newly selected row then takes
   * focus. Otherwise it only scrolls into view, so J or K never pulls focus
   * off a control.
   */
  focusOnSelect?: boolean;
  /**
   * The phone layout, below `sm`: the chip moves down beside "Spoke …"
   * and the title may run to two lines. A 390 px phone leaves a row about
   * 220 px for text, too little for a name, a chip and a button.
   */
  compact?: boolean;
}

/**
 * The leading glyph's circle: 24 px on screen with a 44 px tap box, and the
 * hover layer rather than a fill, so the glyph keeps its group's color.
 */
const GLYPH =
  "hit-area state-layer w-6 h-6 rounded-full flex items-center justify-center shrink-0 cursor-pointer";

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
 * One row of the Up next queue. A click anywhere opens the contact, like
 * Enter, unless it starts on a control inside the row. A birthday or a
 * catch-up row has no snooze: there is no date to move.
 *
 * The row is the list's one roving tab stop, and its controls are Tab stops
 * only while it is current. Enter opens the contact, Space does the primary
 * action, and the arrows move the highlight. Keys count only when the row
 * itself is the target, so a button inside keeps its own Enter and Space.
 * Focus anywhere in the row makes it current.
 */
export const ActionRow = memo(
  ({
    item,
    isSelected = false,
    looksSelected = false,
    onSelect,
    onComplete,
    onSnooze,
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
    const tabIndex = isSelected ? 0 : -1;

    useEffect(() => {
      return () => {
        if (completeTimerRef.current) {
          clearTimeout(completeTimerRef.current);
        }
      };
    }, []);

    // A row the highlight arrives on scrolls into view, and takes focus when
    // focus is in the list but not already in this row (Tab onto its check
    // makes it current). A row picked while the keyboard is off the list does
    // not scroll: on load that moved the browser's Tab start point, and the
    // first Tab skipped the skip link and the sidebar.
    useEffect(() => {
      const arrived = isSelected && !wasSelectedRef.current;
      wasSelectedRef.current = isSelected;
      if (!arrived || !(looksSelected || focusOnSelect)) return;
      const el = rowRef.current;
      if (!el) return;
      // jsdom has no scrollIntoView, so the call is optional.
      el.scrollIntoView?.({ block: "nearest" });
      if (focusOnSelect && !el.contains(document.activeElement)) {
        el.focus({ preventScroll: true });
      }
    }, [isSelected, looksSelected, focusOnSelect]);

    // The check shows done while it animates. A row that stays because the
    // write failed must work again.
    const complete = () => {
      if (isCompleting) return;
      setIsCompleting(true);
      completeTimerRef.current = setTimeout(() => {
        setIsCompleting(false);
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
      onSelect: () => onSnooze?.(item, preset.days),
    }));

    // A catch-up's chip already says how long it has been.
    const lastSpoke =
      item.kind !== "catch-up" && item.lastContactedAt
        ? formatRelative(item.lastContactedAt)
        : null;

    // The chip's tone says how soon the row is due. The glyph takes the
    // group's tone, like the dot beside the group's name.
    const chip = (
      <span
        className={cn(PULSE_CHIP, TONE_WASH[DUE_TONE[item.dueChip.variant]])}
      >
        {item.dueChip.text}
      </span>
    );
    const tone = GROUP_TONE[item.group];

    // On a phone or a touch screen it ends line one at rest, and its negative
    // margin keeps line one as tall as the name. With a fine pointer it
    // floats over the row's right edge and shows on hover or focus.
    const snooze = item.hasCheckAction ? (
      <ActionMenu
        label="Snooze item"
        title="Snooze"
        heading="Snooze until"
        icon={Clock}
        iconClassName="w-4 h-4"
        items={snoozeItems}
        // The trigger takes no tabIndex prop, so the roving stop is set here.
        triggerRef={(el) => {
          if (el) el.tabIndex = tabIndex;
        }}
        className={cn(
          "shrink-0",
          compact
            ? "ml-auto"
            : "ml-auto transition-opacity pointer-fine:ml-0 pointer-fine:absolute pointer-fine:right-2 pointer-fine:top-1/2 pointer-fine:-translate-y-1/2 pointer-fine:rounded-lg pointer-fine:bg-surface-container-low/95 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
        )}
        triggerClassName={
          compact ? "-my-1.5" : "p-1 rounded-lg -my-1.5 pointer-fine:my-0"
        }
      />
    ) : null;

    return (
      // A list item with its own keys on purpose. The two rules disabled here
      // ask for role="button", which would take the list semantics away.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        ref={rowRef}
        role="listitem"
        aria-current={isSelected ? "true" : undefined}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={isSelected ? 0 : -1}
        onFocus={() => {
          if (!isSelected) onSelect?.();
        }}
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "state-layer group relative w-full flex items-center rounded-xl py-2.5 transition-colors cursor-pointer",
          compact ? "gap-2.5 px-2.5" : "gap-3 px-3",
          looksSelected ? SELECTED_ROW : "bg-surface-container-low/70",
          isCompleting && "opacity-50",
        )}
      >
        {/* The check for a follow-up, Log for a birthday or a catch-up. */}
        {item.hasCheckAction ? (
          <button
            type="button"
            onClick={handleComplete}
            disabled={isCompleting}
            tabIndex={tabIndex}
            aria-label={`Mark "${item.title}" done`}
            className={cn(
              GLYPH,
              "border-2 transition-all duration-(--dur-fast)",
              // The success wash and ink clear AA. White on raw green does not.
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
            tabIndex={tabIndex}
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
            tabIndex={tabIndex}
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

        {/* Line one wraps, so a long name pushes the chip down, not off. */}
        <div className="flex flex-col flex-1 min-w-0 gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              to={`/contact/${item.contactId}`}
              onClick={(e) => e.stopPropagation()}
              tabIndex={tabIndex}
              className={cn(
                PULSE_TYPE.name,
                "hit-area inline-flex hover:text-primary transition-colors",
                // A second cue: the tint alone is about 1.06 to 1 on the wash.
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
              {/* "Spoke" on a phone: with "Last", the line was 20 px too
                  wide beside a chip and wrapped, so each row took 4 lines. */}
              {lastSpoke && (
                <span className={PULSE_TYPE.meta}>
                  {compact ? "Spoke" : "Last spoke"} {lastSpoke}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);
