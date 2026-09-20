import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Clock, CalendarDays, Calendar } from "lucide-react";
import { addDays } from "date-fns";
import { useUpdateActionItem } from "../../../api";
import { cn } from "../../../lib/utils";
import {
  MENU_HEADING,
  MENU_ICON,
  MENU_ITEM,
  MENU_PANEL,
} from "../../../lib/styles";

export interface SnoozeMenuProps {
  itemId: string;
  isOpen: boolean;
  onClose: () => void;
  triggerRect?: DOMRect | null;
}

/** The panel's width in px (`w-44`), so its right edge meets the trigger's. */
const MENU_WIDTH = 176;

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

    // Focus first menuitem
    const firstButton = menuRef.current?.querySelector<HTMLButtonElement>(
      'button[role="menuitem"]',
    );
    firstButton?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            'button[role="menuitem"]',
          ) || [],
        );
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        if (idx === -1) {
          items[0]?.focus();
        } else {
          const next =
            e.key === "ArrowDown"
              ? (idx + 1) % items.length
              : (idx - 1 + items.length) % items.length;
          items[next]?.focus();
        }
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
        position: "fixed",
        top: triggerRect.bottom + 4,
        left: Math.max(
          10,
          Math.min(
            window.innerWidth - MENU_WIDTH - 10,
            triggerRect.right - MENU_WIDTH,
          ),
        ),
      }
    : {};

  return createPortal(
    <div
      ref={menuRef}
      style={style}
      role="menu"
      aria-label="Snooze item"
      className={cn(MENU_PANEL, "z-50 w-44 min-w-0")}
    >
      <div role="presentation" className={MENU_HEADING}>
        Snooze until
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => handleSnooze(1)}
        className={MENU_ITEM}
      >
        <Clock aria-hidden="true" className={MENU_ICON} />
        Tomorrow
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => handleSnooze(3)}
        className={MENU_ITEM}
      >
        <CalendarDays aria-hidden="true" className={MENU_ICON} />
        In 3 days
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => handleSnooze(7)}
        className={MENU_ITEM}
      >
        <Calendar aria-hidden="true" className={MENU_ICON} />
        Next week
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => handleSnooze(30)}
        className={MENU_ITEM}
      >
        <Calendar aria-hidden="true" className={MENU_ICON} />
        Next month
      </button>
    </div>,
    document.body,
  );
};
