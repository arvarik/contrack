/**
 * RailTooltip: the label beside an icon on the rail, or beside a button at
 * the window's right edge.
 *
 * The left nav is a column of icons with no text, and the right-hand panel's
 * button (`SidePanel`) sits at the window's right edge. On hover, after a
 * 250 ms pause, the icon's name (and its key, when it has one) appears
 * beside it, on the side away from the window's edge: to the right of the
 * left nav, to the left of the panel's button.
 *
 * It is a hover-rendered `<div>`, so it is worth nothing to a screen reader
 * or to a keyboard user. Every icon it labels carries its own `aria-label`
 * with the same words.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE } from "../../lib/motion";
import { cn } from "../../lib/utils";

export const RailTooltip = ({
  label,
  shortcut,
  side = "right",
  disabled = false,
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  /** Where the label opens: away from the rail's edge. */
  side?: "right" | "left";
  /**
   * Shows nothing. An open side panel names itself in its heading, and the
   * label would open over the panel's own controls.
   */
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (disabled) return;
    timerRef.current = setTimeout(() => setVisible(true), 250);
  }, [disabled]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  // While disabled it forgets the hover. The panel's button is disabled
  // while its panel is open, and the pointer that closes the panel rests on
  // it: the label waits for the pointer to come back, and does not appear
  // under a pointer that has just used the button.
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const right = side === "right";

  return (
    <div
      className={cn("relative flex items-center", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      <AnimatePresence>
        {visible && !disabled && (
          <motion.div
            initial={{ opacity: 0, x: right ? -6 : 6, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: right ? -4 : 4, scale: 0.95 }}
            transition={{ duration: DURATION.fast, ease: EASE }}
            className={cn(
              "absolute z-50 pointer-events-none",
              right ? "left-full ml-3" : "right-full mr-3",
            )}
          >
            {/* The caret points at the icon: a square turned 45 degrees,
                half of it under the label. */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-surface-container-highest",
                right ? "-left-1" : "-right-1",
              )}
            />
            <div className="relative bg-surface-container-highest text-on-surface text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap ring-1 ring-outline-variant/40">
              {label}
              {shortcut && (
                <span className="block text-[11px] font-mono font-normal text-on-surface-variant mt-0.5">
                  {shortcut}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
