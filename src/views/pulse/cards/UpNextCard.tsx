import React, { useEffect, useRef } from "react";
import { CheckSquare, PartyPopper, PenLine } from "lucide-react";
import confetti from "canvas-confetti";
import { CardFrame } from "../components/CardFrame";
import { ActionRow } from "./ActionRow";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SECTION_HEADING } from "../../../lib/styles";
import { openQuickNote } from "../../../lib/appEvents";
import { flyCorvid } from "../../../lib/corvid";
import type { UpNextGroupMeta, UpNextItem } from "../lib/upNext";

export interface UpNextCardProps {
  items: UpNextItem[];
  groups: UpNextGroupMeta[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onComplete: (id: string) => void;
  onLog: (contactId: string) => void;
  onOpenContact: (contactId: string) => void;
}

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

  useEffect(() => {
    if (
      prevItemCountRef.current !== null &&
      prevItemCountRef.current > 0 &&
      items.length === 0
    ) {
      // Fire confetti when last item is cleared!
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#009EDB", "#10B981", "#F59E0B"],
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

  return (
    <CardFrame
      cardId="up-next"
      title="Up next"
      icon={CheckSquare}
      count={items.length}
      headerAction={
        <>
          <span className="hidden 2xl:inline-block text-[11px] text-on-surface-variant font-medium tracking-tight">
            <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              J
            </kbd>
            <kbd className="ml-0.5 px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              K
            </kbd>{" "}
            walk ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              D
            </kbd>{" "}
            done ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              S
            </kbd>{" "}
            snooze ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              L
            </kbd>{" "}
            note ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              ↵
            </kbd>{" "}
            open
          </span>
          <span className="hidden xl:inline-block 2xl:hidden text-[11px] text-on-surface-variant font-medium tracking-tight">
            <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              J
            </kbd>
            <kbd className="ml-0.5 px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              K
            </kbd>{" "}
            walk ·{" "}
            <kbd className="px-1 py-0.5 rounded bg-surface-container font-mono text-[11px]">
              D
            </kbd>{" "}
            done
          </span>
        </>
      }
    >
      {items.length === 0 ? (
        <div className="py-8">
          <EmptyState
            level={3}
            icon={PartyPopper}
            title="No follow-ups"
            body="Log a note to keep the streak."
            action={{
              label: "Log an interaction",
              icon: PenLine,
              onClick: () => openQuickNote(),
            }}
          />
        </div>
      ) : (
        <div role="list" aria-label="Up next items" className="space-y-6">
          {groups.map((group) => {
            return (
              <div key={group.group} className="space-y-2">
                {/* Group sticky header */}
                <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-xs py-1 flex items-center justify-between border-b border-outline/10">
                  <span className={SECTION_HEADING}>{group.label}</span>
                  <span className="text-xs text-on-surface-variant font-bold tabular-nums">
                    {group.count}
                  </span>
                </div>

                {/* Group rows */}
                <div className="space-y-2">
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
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardFrame>
  );
};
