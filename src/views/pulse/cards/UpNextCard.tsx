import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PartyPopper, PenLine } from "lucide-react";
import confetti from "canvas-confetti";
import { CardFrame } from "../components/CardFrame";
import { ActionRow } from "./ActionRow";
import { EmptyState } from "../../../components/ui/EmptyState";
import { InfoTip } from "../../../components/ui/InfoTip";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { KBD_SM, TONE_DOT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { openQuickNote } from "../../../lib/appEvents";
import { flyWhenClear } from "../../../lib/corvid";
import { GROUP_TONE, PULSE_TYPE } from "../lib/pulseStyles";
import { groupHeadingId, SHOW_ALL_UP_NEXT } from "../lib/jumpToGroup";
import { prefersReducedMotion } from "../../../lib/motion";
import type { UpNextGroupMeta, UpNextItem } from "../lib/upNext";

interface UpNextCardProps {
  items: UpNextItem[];
  groups: UpNextGroupMeta[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  /**
   * Whether the selected row wears its tint: on after a queue key or when
   * keyboard focus enters the list, off when focus leaves or a pointer
   * presses outside it.
   */
  selectionShown: boolean;
  onSelectionShownChange: (shown: boolean) => void;
  onComplete: (id: string) => void;
  onSnooze: (item: UpNextItem, days: number) => void;
  onLog: (contactId: string) => void;
  onOpenContact: (contactId: string) => void;
}

/** Rows before "Show all" on one column. 38 rows ran 4,300 px on a phone. */
const FIRST_ROWS = 8;

/** A theme color for the confetti, read at the moment it fires. */
const themeColor = (name: string, fallback: string) => {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className={cn(KBD_SM, "not-italic")}>{children}</kbd>
);

export const UpNextCard = ({
  items,
  groups,
  selectedIndex,
  onSelectIndex,
  selectionShown,
  onSelectionShownChange,
  onComplete,
  onSnooze,
  onLog,
  onOpenContact,
}: UpNextCardProps) => {
  const prevItemCountRef = useRef<number | null>(null);
  /** Focus is inside the list, so a newly highlighted row takes focus. */
  const [focusWithin, setFocusWithin] = useState(false);
  /** Below sm the rows take the phone anatomy. See `ActionRow`. */
  const compact = !useMediaQuery("(min-width: 640px)");
  /** From lg the pane scrolls inside the card, so every row is drawn. */
  const scrolls = useMediaQuery("(min-width: 1024px)");
  const [showAll, setShowAll] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // A jump to a group past the first rows (the masthead's counts, Keeping
  // up's "to catch up") shows them all before it looks for the heading.
  useEffect(() => {
    const show = () => flushSync(() => setShowAll(true));
    window.addEventListener(SHOW_ALL_UP_NEXT, show);
    return () => window.removeEventListener(SHOW_ALL_UP_NEXT, show);
  }, []);

  // J and K walk past the first rows: the rest come with them.
  const limit = scrolls || showAll ? items.length : FIRST_ROWS;
  useEffect(() => {
    if (selectedIndex >= limit) setShowAll(true);
  }, [selectedIndex, limit]);

  // A pointer press outside the list takes the tint away, like focus that
  // leaves it. The snooze menu's panel sits inside its row in the DOM, so a
  // press on it is inside the list.
  useEffect(() => {
    if (!selectionShown) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!paneRef.current?.contains(e.target as Node | null)) {
        onSelectionShownChange(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selectionShown, onSelectionShownChange]);

  useEffect(() => {
    if (
      prevItemCountRef.current !== null &&
      prevItemCountRef.current > 0 &&
      items.length === 0
    ) {
      // Confetti in the palette's colors when the last item is cleared,
      // unless less motion is asked for.
      if (!prefersReducedMotion()) {
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 },
          colors: [
            themeColor("--color-primary", "#006a91"),
            themeColor("--color-success", "#046b4e"),
            themeColor("--color-warning", "#9a4c08"),
          ],
        });
      }
      // The bird's lap of honor. The overlay flies it only at level "full",
      // and reduced motion already reads as "off".
      flyWhenClear({ kind: "swoop" });
    }
    prevItemCountRef.current = items.length;

    return () => {
      confetti.reset();
    };
  }, [items.length]);

  /** Step the highlight from a row, within the list's bounds. */
  const moveFrom = (globalIdx: number, direction: -1 | 1) => {
    const next = globalIdx + direction;
    if (next >= 0 && next < items.length) onSelectIndex(next);
  };

  return (
    <CardFrame
      cardId="up-next"
      title="Up next"
      count={items.length}
      headerAction={
        <InfoTip label="Keyboard" align="end" className="hidden sm:inline-flex">
          <span className="block font-semibold mb-1">Keys</span>
          <Key>J</Key> <Key>K</Key> walk the rows. <Key>D</Key> done,{" "}
          <Key>S</Key> snooze a day, <Key>L</Key> log a note. Tab into the list,
          then <Key>↑</Key> <Key>↓</Key> move, <Key>Enter</Key> opens the
          contact, <Key>Space</Key> does the row&apos;s action and{" "}
          <Key>Tab</Key> reaches its buttons
        </InfoTip>
      }
    >
      {items.length === 0 ? (
        <div className="py-8">
          <EmptyState
            level={3}
            icon={PartyPopper}
            title="Nothing due today"
            body="Log a note to keep the streak"
            action={{
              label: "Log note",
              icon: PenLine,
              onClick: () => openQuickNote(),
            }}
          />
        </div>
      ) : (
        // From lg the pane scrolls inside the card with sticky headings, and
        // the reserved gutter keeps rows from shifting. Each section holds its
        // own list under its heading: a heading inside a list fails axe. The
        // first row is current from the start but wears the tint only while
        // the keyboard is on the list: on load it read as a stray highlight.
        <div
          ref={paneRef}
          role="group"
          aria-label="Up next items"
          className="flex flex-col gap-5 lg:max-h-[calc(100dvh-17rem)] lg:min-h-[20rem] lg:overflow-y-auto lg:overflow-x-hidden lg:[scrollbar-gutter:stable] lg:-mr-2 lg:pr-2 lg:-ml-1 lg:pl-1"
          onFocus={(e) => {
            setFocusWithin(true);
            // Keyboard focus shows the tint, so it follows Tab from row to
            // row. A click does not: the tint is for the keyboard.
            if (e.target.matches(":focus-visible")) {
              onSelectionShownChange(true);
            }
          }}
          onBlur={(e) => {
            // Focus moving to another row or a control in one stays inside.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setFocusWithin(false);
              onSelectionShownChange(false);
            }
          }}
        >
          {visibleGroups(groups, limit).map((group) => (
            <section key={group.group} className="flex flex-col gap-1.5">
              <h3
                id={groupHeadingId(group.group)}
                className={cn(
                  PULSE_TYPE.group,
                  "flex items-center gap-2 py-1.5 lg:sticky lg:top-0 z-10 bg-surface-container-lowest",
                )}
              >
                {/* The group's tone, as on its rows' glyphs. Decorative. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    TONE_DOT[GROUP_TONE[group.group]],
                  )}
                />
                {group.label}
                {/* "10 of 14" when the server sent its ten and more wait. */}
                <span className="ml-auto tabular-nums font-medium">
                  {group.of !== undefined
                    ? `${group.count} of ${group.of}`
                    : group.count}
                </span>
              </h3>

              <div
                role="list"
                aria-label={group.label}
                className="flex flex-col gap-1.5"
              >
                {group.items.map((item) => {
                  const globalIdx = items.findIndex((i) => i.id === item.id);
                  const isSelected = globalIdx === selectedIndex;

                  return (
                    <ActionRow
                      key={item.id}
                      item={item}
                      isSelected={isSelected}
                      looksSelected={isSelected && selectionShown}
                      onSelect={() => onSelectIndex(globalIdx)}
                      onComplete={onComplete}
                      onSnooze={onSnooze}
                      onLog={onLog}
                      onOpenContact={onOpenContact}
                      onMove={(direction) => moveFrom(globalIdx, direction)}
                      focusOnSelect={focusWithin}
                      compact={compact}
                    />
                  );
                })}
              </div>
            </section>
          ))}
          {limit < items.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="btn-secondary btn-sm self-start"
            >
              Show all {items.length}
            </button>
          )}
        </div>
      )}
    </CardFrame>
  );
};

/** The groups cut to their first `limit` rows in all, in order. */
function visibleGroups(
  groups: UpNextGroupMeta[],
  limit: number,
): UpNextGroupMeta[] {
  let left = limit;
  const shown: UpNextGroupMeta[] = [];
  for (const group of groups) {
    if (left <= 0) break;
    shown.push(
      left >= group.items.length
        ? group
        : { ...group, items: group.items.slice(0, left) },
    );
    left -= group.items.length;
  }
  return shown;
}
