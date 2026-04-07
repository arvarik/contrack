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
 * Danger items have `danger: true` (rendered in rose).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
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

export const ContextMenu = ({ x, y, items, isOpen, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', handleKey);
    // Use capture to fire before other handlers
    window.addEventListener('mousedown', handleClick, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleClick, true);
    };
  }, [isOpen, onClose]);

  // Clamp to viewport so menu never clips off-screen
  const [adjustedPos, setAdjustedPos] = useState({ x, y });
  useEffect(() => {
    if (!isOpen || !menuRef.current) { setAdjustedPos({ x, y }); return; }
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
          transition={{ duration: 0.1 }}
          style={{ position: 'fixed', left: adjustedPos.x, top: adjustedPos.y }}
          className="z-[300] min-w-[180px] glass-panel rounded-xl shadow-2xl py-1 overflow-hidden"
          onContextMenu={(e) => e.preventDefault()}
        >
          {items.map((item) => {
            if (item.separator) {
              return <div key={item.id} className="my-1 h-px bg-surface-container-high mx-2" />;
            }
            return (
              <button
                key={item.id}
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onClick?.();
                }}
                className={[
                  'w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors text-left',
                  item.danger
                    ? 'text-rose-500 hover:bg-rose-500/10 disabled:opacity-40'
                    : 'text-on-surface hover:bg-surface-container-low disabled:opacity-40',
                ].join(' ')}
              >
                {item.icon && (
                  <span className={item.danger ? 'text-rose-400' : 'text-on-surface-variant'}>
                    {item.icon}
                  </span>
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
    []
  );

  const closeContextMenu = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return { contextMenu: state, handleContextMenu, closeContextMenu };
};
