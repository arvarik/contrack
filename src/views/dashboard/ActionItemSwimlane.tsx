import React, { useState } from "react";
import { cn } from "../../lib/utils";
import { SECTION_HEADING } from "../../lib/styles";
import { ActionItem } from "../../types";
import {
  Check,
  Clock,
  CalendarDays,
  MoreVertical,
  Keyboard,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useCompleteActionItem, useUpdateActionItem } from "../../api";
import { format, addDays } from "date-fns";
import { createPortal } from "react-dom";

interface SwimlaneProps {
  title: string;
  items: ActionItem[];
  theme: "urgent" | "today" | "upcoming";
  /** CSS entrance delay from `tileDelay(index)`. */
  delay?: string;
  firstActionItemId?: string;
}

const SnoozeDropdown = ({
  item,
  onClose,
  triggerRect,
}: {
  item: ActionItem;
  onClose: () => void;
  triggerRect: DOMRect;
}) => {
  const update = useUpdateActionItem();

  const handleSnooze = (days: number) => {
    const newDate = addDays(new Date(), days).toISOString();
    update.mutate({ id: item.id, data: { dueAt: newDate } });
    onClose();
  };

  const top = triggerRect.bottom + window.scrollY;
  const left = triggerRect.right - 150; // align right roughly

  return createPortal(
    <>
      {/* Click-outside catcher. Presentational — Escape is the keyboard path
          (see the effect above), so this needs no tab stop. */}
      <div
        role="presentation"
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute z-50 mt-1 w-36 overflow-hidden rounded-xl glass-panel py-1 shadow-xl outline-none",
        )}
        style={{ top, left: Math.max(10, left) }}
      >
        <div className="px-3 py-1.5 bg-surface-container-high text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
          Snooze
        </div>
        <button
          onClick={() => handleSnooze(1)}
          className="w-full justify-start flex items-center px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-primary/15 hover:text-primary transition-colors"
        >
          <Clock className="w-3 h-3 mr-2 opacity-80" /> Tomorrow
        </button>
        <button
          onClick={() => handleSnooze(3)}
          className="w-full justify-start flex items-center px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-primary/15 hover:text-primary transition-colors"
        >
          <CalendarDays className="w-3 h-3 mr-2 opacity-80" /> In 3 days
        </button>
        <button
          onClick={() => handleSnooze(7)}
          className="w-full justify-start flex items-center px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-primary/15 hover:text-primary transition-colors"
        >
          <CalendarDays className="w-3 h-3 mr-2 opacity-80" /> Next week
        </button>
      </div>
    </>,
    document.body,
  );
};

const ActionCard = ({
  item,
  theme,
  isActive,
}: {
  item: ActionItem;
  theme: string;
  isActive?: boolean;
}) => {
  const complete = useCompleteActionItem();
  const [showSnooze, setShowSnooze] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  /** Local "completing" flag drives the strikethrough animation before the row exits */
  const [isCompleting, setIsCompleting] = useState(false);

  const colors = {
    urgent:
      "text-error border-error/20 bg-error/5 hover:bg-error/10 hover:border-error/40",
    today:
      "text-primary border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40",
    upcoming:
      "text-on-surface-variant border-surface-container bg-surface-container-lowest hover:bg-surface-container",
  };

  const checkColors = {
    urgent: "border-error/30 text-error hover:bg-error hover:text-white",
    today:
      "border-primary/30 text-primary hover:bg-primary hover:text-on-primary",
    upcoming:
      "border-on-surface-variant/30 text-on-surface-variant hover:bg-primary hover:text-on-primary hover:border-primary",
  };

  const handleComplete = () => {
    if (isCompleting) return;
    setIsCompleting(true);
    // Delay the actual mutation so the strikethrough animation plays first (300ms)
    setTimeout(() => {
      complete.mutate(item.id);
    }, 300);
  };

  return (
    <div
      className={cn(
        "w-full rounded-xl border p-4 flex items-center gap-4 transition-all duration-300 group shadow-sm relative",
        colors[theme as keyof typeof colors],
        isActive &&
          "ring-2 ring-primary border-primary ring-offset-2 ring-offset-surface scale-[1.01] z-10",
        isCompleting && "opacity-50 scale-[0.98]",
      )}
    >
      {/* Checkbox */}
      <button
        onClick={handleComplete}
        disabled={isCompleting || complete.isPending}
        className={cn(
          "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-200",
          checkColors[theme as keyof typeof checkColors],
          isCompleting &&
            "bg-emerald-500 border-emerald-500 text-white scale-110",
        )}
      >
        <Check
          className={cn(
            "w-3.5 h-3.5 transition-opacity",
            isCompleting ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        />
      </button>

      {/* Content */}
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className={cn(
            "font-bold text-on-surface truncate pr-2 transition-all duration-300",
            isCompleting && "line-through opacity-40",
          )}
        >
          {item.title}
        </span>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-xs font-semibold text-on-surface-variant truncate max-w-[150px]">
            {item.contactName || "Unknown"}
          </span>
          <span className="w-1 h-1 rounded-full bg-surface-container-high" />
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              theme === "urgent" && "text-error font-extrabold",
            )}
          >
            {format(new Date(item.dueAt), "MMM d, h:mm a")}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
        <button
          onClick={(e) => {
            setTriggerRect(e.currentTarget.getBoundingClientRect());
            setShowSnooze(true);
          }}
          className="p-1 rounded-lg text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {showSnooze && triggerRect && (
        <SnoozeDropdown
          item={item}
          onClose={() => setShowSnooze(false)}
          triggerRect={triggerRect}
        />
      )}
    </div>
  );
};

export const ActionItemSwimlane = ({
  title,
  items,
  theme,
  delay,
  firstActionItemId,
}: SwimlaneProps) => {
  if (items.length === 0) return null;

  const hasActiveItem = items.some((item) => item.id === firstActionItemId);

  return (
    <div
      style={{ animationDelay: delay }}
      className="tile-enter flex flex-col gap-3"
    >
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={cn(SECTION_HEADING, "mb-0")}>{title}</span>
          <span className="text-[10px] bg-surface-container px-2 py-0.5 rounded font-mono text-on-surface-variant font-bold">
            {items.length}
          </span>
        </div>
        {hasActiveItem && (
          <div className="hidden md:flex items-center gap-2 text-on-surface-variant group/hint cursor-help relative">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-0 group-hover/hint:opacity-100 transition-opacity translate-x-2 group-hover/hint:translate-x-0">
              Press{" "}
              <kbd className="bg-surface-container rounded px-1 font-mono">
                D
              </kbd>{" "}
              Done ·{" "}
              <kbd className="bg-surface-container rounded px-1 font-mono">
                S
              </kbd>{" "}
              Snooze ·{" "}
              <kbd className="bg-surface-container rounded px-1 font-mono">
                L
              </kbd>{" "}
              Log
            </span>
            <Keyboard className="w-4 h-4 opacity-50 group-hover/hint:opacity-100 transition-opacity group-hover/hint:text-primary" />
          </div>
        )}
      </div>

      {/*
        Exit-only animation. The rows used to carry `layout` plus a
        height 0 ↔ auto enter animation, which made Motion re-measure every
        row on every render of this list — including the ones triggered by an
        unrelated background refetch — and the whole lane twitched. Collapsing
        the height on exit alone still reads as "the item was checked off",
        and costs nothing on the far more common re-render path.
      */}
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={false}
              exit={{ opacity: 0, height: 0, marginTop: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <ActionCard
                item={item}
                theme={theme}
                isActive={item.id === firstActionItemId}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
