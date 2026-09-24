import React, { useEffect, useRef, useState } from "react";
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
import { flyCorvid } from "../../../lib/corvid";
import { GROUP_TONE, PULSE_TYPE } from "../lib/pulseStyles";
import { groupHeadingId } from "../lib/jumpToGroup";
import type { UpNextGroupMeta, UpNextItem } from "../lib/upNext";

export interface UpNextCardProps {
  items: UpNextItem[];
  groups: UpNextGroupMeta[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  /**
   * Whether the selected row wears its tint. The page turns it on when a
   * queue key (J, K, D, S, L) acts on the selected row. The card turns it on
   * when keyboard focus enters the list, and off when focus leaves it or a
   * pointer presses outside it.
   */
  selectionShown: boolean;
  onSelectionShownChange: (shown: boolean) => void;
  onComplete: (id: string) => void;
  onLog: (contactId: string) => void;
  onOpenContact: (contactId: string) => void;
}

/** A theme colour for the confetti, read at the moment it fires. */
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
  onLog,
  onOpenContact,
}: UpNextCardProps) => {
  const prevItemCountRef = useRef<number | null>(null);
  /**
   * Whether focus is inside the list. A row that becomes highlighted while
   * this is true takes focus, so the arrows walk the rows. A bare J or K
   * pressed with focus elsewhere only scrolls the row into view.
   */
  const [focusWithin, setFocusWithin] = useState(false);
  /** Below sm the rows take the phone anatomy. See `ActionRow`. */
  const compact = !useMediaQuery("(min-width: 640px)");
  const paneRef = useRef<HTMLDivElement>(null);

  // A pointer press outside the list takes the tint away, as focus that
  // leaves the list does. A bare J or K shows the tint with focus anywhere
  // on the page, and a click elsewhere used to leave it on the row. The
  // snooze menu's panel sits inside its row in the DOM, so a press on it
  // is inside the list.
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
      // Fire confetti when the last item is cleared, in the palette's own
      // colours, so a rose accent gets rose confetti.
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
      // And the bird takes a lap of honour across the top of the page. The
      // overlay decides whether it actually flies: it runs the swoop only at
      // level "full", and reduced motion, from the account or the operating
      // system, is already "off" by the time it reads the level.
      flyCorvid({ kind: "swoop" });
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
          contact and <Key>Space</Key> does the row&apos;s action
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
        // The pane. From lg it scrolls inside the card, capped near the
        // viewport, and the group headings stick to it in the card's own
        // colour. The gutter is reserved so the rows never shift when the
        // pane starts to scroll. Below lg it has no cap and the headings
        // scroll with the page. It is a named group and each section holds
        // its own list under its heading: a list may own only list items,
        // so a heading inside one is a structure a screen reader cannot
        // read, and axe fails it.
        //
        // The first row is the current row from the start, for the keys and
        // for a screen reader, but it wears the selected tint only while the
        // keyboard is on the list. On load the tint read as a stray
        // highlight on a row nobody had chosen.
        <div
          ref={paneRef}
          role="group"
          aria-label="Up next items"
          className="flex flex-col gap-5 lg:max-h-[calc(100dvh-17rem)] lg:min-h-[20rem] lg:overflow-y-auto lg:overflow-x-hidden lg:[scrollbar-gutter:stable] lg:-mr-2 lg:pr-2 lg:-ml-1 lg:pl-1"
          onFocus={(e) => {
            setFocusWithin(true);
            // The row that focus enters is the current row by now (see
            // `ActionRow`). Keyboard focus shows it, so the tint and the
            // live status follow Tab from row to row. A click does not
            // show it: the tint is for the keyboard.
            if (e.target.matches(":focus-visible")) {
              onSelectionShownChange(true);
            }
          }}
          onBlur={(e) => {
            // Focus moving from one row to another, or to a control inside
            // a row, stays inside the list.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setFocusWithin(false);
              onSelectionShownChange(false);
            }
          }}
        >
          {groups.map((group) => (
            <section key={group.group} className="flex flex-col gap-1.5">
              <h3
                id={groupHeadingId(group.group)}
                className={cn(
                  PULSE_TYPE.group,
                  "flex items-center gap-2 py-1.5 lg:sticky lg:top-0 z-10 bg-surface-container-lowest",
                )}
              >
                {/* A 6 px dot in the group's tone, the same tone as its rows'
                    leading glyphs, so the eye finds a group before it reads
                    the word. Decoration: the word is there. */}
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
        </div>
      )}
    </CardFrame>
  );
};
