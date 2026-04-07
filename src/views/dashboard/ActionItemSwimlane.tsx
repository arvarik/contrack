import React, { useState } from 'react';
import { cn } from "../../lib/utils";
import { CARD_COMPACT, SECTION_HEADING, TAG_PILL } from "../../lib/styles";
import { ActionItem } from "../../types";
import { Check, Clock, CalendarDays, MoreVertical, Keyboard } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useCompleteActionItem, useUpdateActionItem } from "../../api";
import { format, isPast, isToday, addDays } from "date-fns";
import { createPortal } from "react-dom";

interface SwimlaneProps {
  title: string;
  items: ActionItem[];
  theme: "urgent" | "today" | "upcoming";
  delay?: number;
  firstActionItemId?: string;
}

const SnoozeDropdown = ({ item, onClose, triggerRect }: { item: ActionItem, onClose: () => void, triggerRect: DOMRect }) => {
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
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div 
        className={cn("absolute z-50 mt-1 w-36 overflow-hidden rounded-lg bg-surface-container-highest py-1 shadow-xl ring-1 ring-white/10 outline-none")}
        style={{ top, left: Math.max(10, left) }}
      >
        <div className="px-3 py-1.5 border-b border-white/5 text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">Snooze</div>
        <button onClick={() => handleSnooze(1)} className="w-full justify-start flex items-center px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-primary/15 hover:text-primary transition-colors">
          <Clock className="w-3 h-3 mr-2 opacity-80" /> Tomorrow
        </button>
        <button onClick={() => handleSnooze(3)} className="w-full justify-start flex items-center px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-primary/15 hover:text-primary transition-colors">
          <CalendarDays className="w-3 h-3 mr-2 opacity-80" /> In 3 days
        </button>
        <button onClick={() => handleSnooze(7)} className="w-full justify-start flex items-center px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-primary/15 hover:text-primary transition-colors">
          <CalendarDays className="w-3 h-3 mr-2 opacity-80" /> Next week
        </button>
      </div>
    </>,
    document.body
  );
};

const ActionCard = ({ item, theme, isActive }: { item: ActionItem, theme: string, isActive?: boolean }) => {
  const complete = useCompleteActionItem();
  const [showSnooze, setShowSnooze] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  const colors = {
    urgent: "text-error border-error/20 bg-error/5 hover:bg-error/10 hover:border-error/40",
    today: "text-primary border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40",
    upcoming: "text-on-surface-variant border-surface-container bg-surface-container-lowest hover:bg-surface-container",
  };

  const checkColors = {
    urgent: "border-error/30 text-error hover:bg-error hover:text-white",
    today: "border-primary/30 text-primary hover:bg-primary hover:text-on-primary",
    upcoming: "border-on-surface-variant/30 text-on-surface-variant hover:bg-primary hover:text-on-primary hover:border-primary",
  };

  return (
    <div className={cn(
      "w-full rounded-xl border p-4 flex items-center gap-4 transition-all duration-300 group shadow-sm relative",
      colors[theme as keyof typeof colors],
      isActive && "ring-2 ring-primary border-primary ring-offset-2 ring-offset-surface scale-[1.01] z-10"
    )}>
      {/* Checkbox */}
      <button 
        onClick={() => complete.mutate(item.id)}
        disabled={complete.isPending}
        className={cn(
          "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
          checkColors[theme as keyof typeof checkColors],
          complete.isPending && "opacity-50 scale-90"
        )}
      >
        <Check className={cn("w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity", complete.isPending && "opacity-100")} />
      </button>

      {/* Content */}
      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-bold text-on-surface truncate pr-2">
          {item.title}
        </span>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-xs font-semibold text-on-surface-variant/80 truncate max-w-[150px]">
            {item.contactName || "Unknown"}
          </span>
          <span className="w-1 h-1 rounded-full bg-surface-container-high" />
          <span className={cn("text-[10px] font-bold uppercase tracking-wider", theme === 'urgent' && 'text-error font-extrabold')}>
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
        <SnoozeDropdown item={item} onClose={() => setShowSnooze(false)} triggerRect={triggerRect} />
      )}
    </div>
  );
};

export const ActionItemSwimlane = ({ title, items, theme, delay = 0, firstActionItemId }: SwimlaneProps) => {
  if (items.length === 0) return null;

  const hasActiveItem = items.some(item => item.id === firstActionItemId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className="flex flex-col gap-3"
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
                  Press <kbd className="bg-surface-container rounded px-1 font-mono">D</kbd> Done · <kbd className="bg-surface-container rounded px-1 font-mono">S</kbd> Snooze · <kbd className="bg-surface-container rounded px-1 font-mono">L</kbd> Log
              </span>
              <Keyboard className="w-4 h-4 opacity-50 group-hover/hint:opacity-100 transition-opacity group-hover/hint:text-primary" />
          </div>
        )}
      </div>
      
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, scale: 0.95, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ActionCard item={item} theme={theme} isActive={item.id === firstActionItemId} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
