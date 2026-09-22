import React, { useEffect, useRef, useState } from "react";
import { PartyPopper, PenLine } from "lucide-react";
import confetti from "canvas-confetti";
import { CardFrame } from "../components/CardFrame";
import { ActionRow } from "./ActionRow";
import { EmptyState } from "../../../components/ui/EmptyState";
import { InfoTip } from "../../../components/ui/InfoTip";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { KBD_SM } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { openQuickNote } from "../../../lib/appEvents";
import { flyCorvid } from "../../../lib/corvid";
import { PULSE_TYPE } from "../lib/pulseStyles";
import { groupHeadingId } from "../lib/jumpToGroup";
import type { UpNextGroup, UpNextGroupMeta, UpNextItem } from "../lib/upNext";

export interface UpNextCardProps {
  items: UpNextItem[];
  groups: UpNextGroupMeta[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onComplete: (id: string) => void;
  onLog: (contactId: string) => void;
  onOpenContact: (contactId: string) => void;
}

/** The id of a group's heading, from `lib/jumpToGroup`. Re-exported for the tests. */
export { groupHeadingId };

/**
 * A 6 px dot before each group's name, in the tone of its chips, so the eye
 * finds a group before it reads the word. Decoration: the word is there.
 */
const GROUP_DOT: Record<UpNextGroup, string> = {
  overdue: "bg-error",
  today: "bg-primary",
  thisWeek: "bg-outline-variant",
  birthdays: "bg-warning",
  "catch-up": "bg-outline-variant",
};

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
          contact and <Key>Space</Key> does the row&apos;s action.
        </InfoTip>
      }
    >
      {items.length === 0 ? (
        <div className="py-8">
          <EmptyState
            level={3}
            icon={PartyPopper}
            title="Nothing due today"
            body="Log a note to keep the streak."
            action={{
              label: "Log a note",
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
        <div
          role="group"
          aria-label="Up next items"
          className="flex flex-col gap-5 lg:max-h-[calc(100dvh-17rem)] lg:min-h-[20rem] lg:overflow-y-auto lg:overflow-x-hidden lg:[scrollbar-gutter:stable] lg:-mr-2 lg:pr-2 nice-scrollbar"
          onFocus={() => setFocusWithin(true)}
          onBlur={(e) => {
            // Focus moving from one row to another, or to a control inside
            // a row, stays inside the list.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setFocusWithin(false);
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
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    GROUP_DOT[group.group],
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
