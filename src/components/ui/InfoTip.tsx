/**
 * A small "what is this?" button that works with a finger, not a hover
 * tooltip, which a phone cannot reach. How it opened decides how it closes:
 *
 * 1. A mouse resting on it opens it, and leaving closes it. A press while it
 *    shows keeps it open (a mouse press first hovers).
 * 2. A keyboard focus opens it, and leaving the button closes it.
 * 3. A press opens it until the next press, Escape, or a press elsewhere.
 *
 * Only a mouse hovers and only a keyboard focus opens, or a tap would open
 * and close it in one gesture. Escape always closes it. The closed panel
 * stays in the page, so the trigger's description reads it on focus.
 */
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { HelpCircle } from "lucide-react";
import { cn } from "../../lib/utils";

/** What opened the panel, or null while it is closed. */
type OpenedBy = "hover" | "focus" | "press" | null;

/** True when a key, not a press, moved the focus here. */
const focusFromKeyboard = (element: Element): boolean => {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
};

export const InfoTip = ({
  label,
  children,
  className,
  align = "start",
  tone = "muted",
  wide = false,
  tabIndex,
}: {
  /** Accessible name for the trigger, e.g. "About the Briefing cache". */
  label: string;
  /** The explanation. Keep it to a sentence or two. */
  children: React.ReactNode;
  className?: string;
  /**
   * The trigger edge the panel lines up with. `end` for a trigger at a
   * card's right edge, so an `overflow-hidden` card does not clip it.
   */
  align?: "start" | "end";
  /**
   * `warning` draws a larger question mark in the warning ink, such as on a
   * result AI did not verify. The label says it in words too.
   */
  tone?: "muted" | "warning";
  /**
   * A panel of 288 px, not 224, for a few short lines that would otherwise
   * wrap to a column, such as a price for each of three providers.
   */
  wide?: boolean;
  /**
   * The trigger's place in the Tab order, for a tip inside a list that is
   * one Tab stop (`useRovingFocus`): -1 off the current row.
   */
  tabIndex?: number;
}) => {
  const [openedBy, setOpenedBy] = useState<OpenedBy>(null);
  const open = openedBy !== null;
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  // A heading can wrap on a phone and move an end-aligned trigger close to
  // the left edge. Keep the whole explanation inside the visible area,
  // using its actual height, and follow scrolling or resized content.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!open || !trigger || !panel) return;
    let active = true;
    const stop = autoUpdate(trigger, panel, () => {
      void computePosition(trigger, panel, {
        placement: `bottom-${align}`,
        middleware: [offset(8), flip(), shift({ padding: 16 })],
      }).then(({ x, y, placement }) => {
        if (!active) return;
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.dataset.side = placement.startsWith("top") ? "top" : "bottom";
      });
    });
    return () => {
      active = false;
      stop();
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node))
        setOpenedBy(null);
    };
    // Escape closes and moves nothing: a focused trigger keeps the focus,
    // and a hovered one leaves it where it was.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedBy(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const reveal = (by: Exclude<OpenedBy, null>) => {
    setOpenedBy(by);
  };

  return (
    <span
      ref={wrapperRef}
      className={cn("relative inline-flex align-middle", className)}
      data-tip={open ? "open" : "closed"}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && !open) reveal("hover");
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && openedBy === "hover")
          setOpenedBy(null);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        tabIndex={tabIndex}
        aria-label={label}
        aria-describedby={panelId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (openedBy === "hover") setOpenedBy("press");
          else if (open) setOpenedBy(null);
          else reveal("press");
        }}
        onFocus={(event) => {
          if (!open && focusFromKeyboard(event.currentTarget)) reveal("focus");
        }}
        onBlur={() => {
          if (openedBy !== "hover") setOpenedBy(null);
        }}
        className={cn(
          // The icon stays 14px in a 24px circle, and `hit-area` grows the
          // tap box to the 44px floor without moving the text around it.
          "hit-area inline-flex items-center justify-center rounded-full min-w-6 min-h-6",
          tone === "warning"
            ? "text-warning hover:bg-warning/10 transition-colors"
            : "text-on-surface-variant hover:text-on-surface transition-colors",
        )}
      >
        <HelpCircle
          className={tone === "warning" ? "w-[18px] h-[18px]" : "w-3.5 h-3.5"}
          aria-hidden="true"
        />
      </button>

      {/* Hidden, not removed, while closed: the description reads it. */}
      <span
        ref={panelRef}
        id={panelId}
        role="tooltip"
        hidden={!open}
        data-side="bottom"
        className={cn(
          // Placement must not animate. The reduced-motion rule sets a
          // short transition duration on every element, including top/left.
          "absolute left-0 top-full z-50 max-w-[calc(100vw-2rem)] transition-none",
          wide ? "w-72" : "w-56",
          // Join the panel to its trigger across the 8 px visual gap. The
          // button's hit area alone leaves a gap on a diagonal pointer move.
          "before:absolute before:inset-x-0 before:h-2 before:content-[''] data-[side=bottom]:before:bottom-full data-[side=top]:before:top-full",
          "bg-surface-container-highest text-on-surface",
          "rounded-xl shadow-xl ring-1 ring-black/5 px-3 py-2",
          "text-[11px] leading-relaxed font-medium normal-case tracking-normal text-left text-pretty",
        )}
      >
        {children}
      </span>
    </span>
  );
};
