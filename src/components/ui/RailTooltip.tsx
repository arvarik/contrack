/**
 * The label of an icon-only control: its name, and its key when it has one,
 * after a 250 ms hover. Beside the rail's icons and the side panel's button,
 * on the side away from the window's edge. Below other controls
 * (`side="bottom"`, or `bottom-end` and `bottom-start` at a header's edges).
 *
 * A long press shows it on a touch screen without pressing the control
 * (`useLongPress`). It is hover-only, so every icon it labels carries an
 * `aria-label` with the same words.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { useLongPress } from "../../hooks/useLongPress";

/** How long a long press keeps the label on screen. */
const TOUCH_SHOW_MS = 1500;

/** Where the label opens, and the caret's place on it, by side. */
const SIDES = {
  right: {
    box: "left-full ml-3",
    caret: "top-1/2 -translate-y-1/2 -left-1",
    from: { x: -6 },
  },
  left: {
    box: "right-full mr-3",
    caret: "top-1/2 -translate-y-1/2 -right-1",
    from: { x: 6 },
  },
  bottom: {
    box: "top-full mt-2 left-1/2",
    caret: "left-1/2 -translate-x-1/2 -top-1",
    from: { y: -4 },
  },
  // The caret sits under the middle of a 32 px icon button.
  "bottom-start": {
    box: "top-full mt-2 left-0",
    caret: "left-3 -top-1",
    from: { y: -4 },
  },
  "bottom-end": {
    box: "top-full mt-2 right-0",
    caret: "right-3 -top-1",
    from: { y: -4 },
  },
} as const;

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
  /** Where the label opens: away from the rail's edge, or under a control. */
  side?: keyof typeof SIDES;
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

  const longPress = useLongPress(() => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), TOUCH_SHOW_MS);
  });

  // While disabled it forgets the hover, so the label does not appear under
  // the pointer that just closed the side panel.
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const { box, caret, from } = SIDES[side];
  // Centered under the control: Motion owns the transform, so the half-width
  // shift is its `x`, not a class.
  const center = side === "bottom" ? { x: "-50%" } : {};

  return (
    <div
      className={cn(
        "relative flex items-center [-webkit-touch-callout:none]",
        className,
      )}
      // A mouse only: a tap's mouse enter would leave the label up.
      onPointerEnter={(event) => event.pointerType === "mouse" && show()}
      onPointerLeave={hide}
      {...longPress}
    >
      {children}
      <AnimatePresence>
        {visible && !disabled && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, ...from, ...center }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1, ...center }}
            exit={{ opacity: 0, scale: 0.95, ...from, ...center }}
            transition={{ duration: DURATION.fast, ease: EASE }}
            className={cn("absolute z-50 pointer-events-none", box)}
          >
            {/* The caret points at the icon: a square turned 45 degrees,
                half of it under the label. */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute w-2 h-2 rotate-45 bg-surface-container-highest",
                caret,
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
