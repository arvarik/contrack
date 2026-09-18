import React, { useEffect, useRef } from "react";
import { Clock, CalendarDays, Calendar } from "lucide-react";
import { addDays } from "date-fns";
import { useUpdateActionItem } from "../../../api";

export interface SnoozeMenuProps {
  itemId: string;
  isOpen: boolean;
  onClose: () => void;
  triggerRect?: DOMRect | null;
}

export const SnoozeMenu = ({
  itemId,
  isOpen,
  onClose,
  triggerRect,
}: SnoozeMenuProps) => {
  const updateAction = useUpdateActionItem();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSnooze = (days: number) => {
    const newDate = addDays(new Date(), days).toISOString();
    updateAction.mutate({ id: itemId, data: { dueAt: newDate } });
    onClose();
  };

  const style: React.CSSProperties = triggerRect
    ? {
        position: "absolute",
        top: triggerRect.bottom + window.scrollY + 4,
        left: Math.max(10, triggerRect.right - 150),
      }
    : {};

  return (
    <div
      ref={menuRef}
      style={style}
      role="menu"
      aria-label="Snooze item"
      className="z-50 w-40 overflow-hidden rounded-xl glass-panel bg-surface-container-highest/95 border border-outline/20 py-1 shadow-xl outline-none text-xs"
    >
      <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
        Snooze until
      </div>
      <button
        role="menuitem"
        onClick={() => handleSnooze(1)}
        className="w-full justify-start flex items-center px-3 py-1.5 min-h-[36px] sm:min-h-0 font-medium text-on-surface hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
      >
        <Clock className="w-3.5 h-3.5 mr-2 opacity-70" /> Tomorrow
      </button>
      <button
        role="menuitem"
        onClick={() => handleSnooze(3)}
        className="w-full justify-start flex items-center px-3 py-1.5 min-h-[36px] sm:min-h-0 font-medium text-on-surface hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
      >
        <CalendarDays className="w-3.5 h-3.5 mr-2 opacity-70" /> In 3 days
      </button>
      <button
        role="menuitem"
        onClick={() => handleSnooze(7)}
        className="w-full justify-start flex items-center px-3 py-1.5 min-h-[36px] sm:min-h-0 font-medium text-on-surface hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
      >
        <Calendar className="w-3.5 h-3.5 mr-2 opacity-70" /> Next week
      </button>
      <button
        role="menuitem"
        onClick={() => handleSnooze(30)}
        className="w-full justify-start flex items-center px-3 py-1.5 min-h-[36px] sm:min-h-0 font-medium text-on-surface hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
      >
        <Calendar className="w-3.5 h-3.5 mr-2 opacity-70" /> Next month
      </button>
    </div>
  );
};
