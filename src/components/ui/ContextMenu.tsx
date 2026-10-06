/**
 * ContextMenu — Portal-based right-click context menu.
 *
 * Usage:
 *   const { contextMenu, handleContextMenu, closeContextMenu } = useContextMenu();
 *
 *   <div onContextMenu={(e) => handleContextMenu(e, myItems)}>...</div>
 *   <ContextMenu {...contextMenu} onClose={closeContextMenu} />
 *
 * Items follow the ContextMenuItem interface. Separator items have `separator: true`.
 *
 * It is a menu like `ActionMenu`: focus moves to the first item when it
 * opens, the arrows, Home, End and letters move (`moveInMenu`), Escape,
 * Tab or Android's Back close it, and focus goes back to the row.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";
import { DURATION, EASE } from "../../lib/motion";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "../../lib/styles";
import type { LucideIcon } from "lucide-react";
import { focusOnPointer } from "../../lib/a11y";
import { useCloseRequest } from "../../hooks/useCloseRequest";
import { moveInMenu } from "./ActionMenu";

interface ContextMenuItem {
  id: string;
  label: string;
  /** A 16 px glyph before the label, drawn as `ActionMenu` draws its own. */
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  isOpen: boolean;
}

interface ContextMenuProps extends ContextMenuState {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// ContextMenu component
// ---------------------------------------------------------------------------

export const ContextMenu = ({
  x,
  y,
  items,
  isOpen,
  onClose,
}: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  /** The row that had focus, where focus goes back when the menu closes. */
  const opener = useRef<HTMLElement | null>(null);
  useCloseRequest(isOpen, onClose);

  useLayoutEffect(() => {
    if (!isOpen) return;
    opener.current = document.activeElement as HTMLElement | null;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [isOpen]);

  /** Close, and put focus back on the row for a keyboard user. */
  const closeToOpener = () => {
    onClose();
    opener.current?.focus({ preventScroll: true });
  };

  // Close on an outside click.
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        onClose();
    };
    // Use capture to fire before other handlers
    window.addEventListener("mousedown", handleClick, true);
    return () => window.removeEventListener("mousedown", handleClick, true);
  }, [isOpen, onClose]);

  // Clamp to viewport so menu never clips off-screen
  const [adjustedPos, setAdjustedPos] = useState({ x, y });
  useEffect(() => {
    if (!isOpen || !menuRef.current) {
      setAdjustedPos({ x, y });
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nx = x + rect.width > vw ? Math.max(0, vw - rect.width - 8) : x;
    const ny = y + rect.height > vh ? Math.max(0, vh - rect.height - 8) : y;
    setAdjustedPos({ x: nx, y: ny });
  }, [isOpen, x, y]);

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: DURATION.fast, ease: EASE }}
          style={{ position: "fixed", left: adjustedPos.x, top: adjustedPos.y }}
          // The panel without `menu-enter`: Motion animates this one.
          className={cn(MENU_PANEL, "menu-enter-none z-[300] min-w-[180px]")}
          role="menu"
          aria-label="Actions"
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeToOpener();
            } else if (e.key === "Tab") {
              onClose();
            } else {
              moveInMenu(e, menuRef.current);
            }
          }}
        >
          {items.map((item) => {
            if (item.separator) {
              return (
                <div key={item.id} role="none" className={MENU_SEPARATOR} />
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onPointerMove={focusOnPointer}
                onClick={() => {
                  closeToOpener();
                  item.onClick?.();
                }}
                // A long press opens this on a phone, so rows are 44 px
                // tall there and 36 px under a pointer. The row, its glyph
                // and its disabled look are `ActionMenu`'s (MENU_ITEM).
                className={MENU_ITEM}
              >
                {item.icon && (
                  <item.icon aria-hidden="true" className={MENU_ICON} />
                )}
                {item.label}
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
};

// ---------------------------------------------------------------------------
// useContextMenu hook — manages ContextMenu open/close + items state
// ---------------------------------------------------------------------------

export const useContextMenu = () => {
  const [state, setState] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    items: [],
    isOpen: false,
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      setState({ x: e.clientX, y: e.clientY, items, isOpen: true });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return { contextMenu: state, handleContextMenu, closeContextMenu };
};
