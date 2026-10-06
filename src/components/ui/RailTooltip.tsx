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
 * Any other icon-only control uses it too, with the label below it
 * (`side="bottom"`): the list's Select and Import, the composer's kinds.
 * A control at a header's right edge takes `bottom-end`, so its label
 * opens leftward and stays on screen, and one at the left edge
 * `bottom-start`.
 *
 * A finger has no hover, so a long press shows the label for a moment
 * instead, and that press does not also press the control
 * (`useLongPress`). A tap still acts at once.
 *
 * It is a hover-rendered `<div>`, so it is worth nothing to a screen reader
 * or to a keyboard user. Every icon it labels carries its own `aria-label`
 * with the same words.
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
      // A mouse only: a tap sends a mouse enter too, and the label then
      // stayed until the next tap somewhere else.
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
