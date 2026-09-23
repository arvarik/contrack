/**
 * SidePanel: the one right-hand panel, a button and the panel it opens.
 *
 * The Ask history and the map's insights open the same way. A button in
 * the page's top-right corner holds the panel's glyph. The panel slides in
 * from the window's right edge, under the button, and over the page, so
 * opening it moves nothing on the page and the button never moves either:
 *
 *   closed                               open
 *   ┌──────────────────────────┐         ┌──────────────┬───────────┐
 *   │                    [ ▦ ] │         │              │ Title 12[▦]│
 *   │                          │         │              │ content   ║│
 *   │         page             │         │     page     │ content   ║│
 *   └──────────────────────────┘         └──────────────┴───────────┘
 *
 *   - The button is a pressable `.btn-secondary`, the family of the page's
 *     call to action, with the panel's glyph and, on the map, its word. It
 *     is a disclosure (`aria-expanded`, `aria-controls`), named for the
 *     panel, and while the panel is open it stays pressed in
 *     (`.btn-latch`), so the one control that opened the panel reads as
 *     the one that closes it. There is no second close button.
 *   - The panel, 320 px, wears the left nav's surface and a soft shadow on
 *     its open edge. Its heading row starts level with the button and
 *     keeps the button's box free at its end. A panel whose button names it
 *     in words can keep its heading for a screen reader and put a control
 *     in the row instead (`titleHidden`, `lead`). Under the heading row the
 *     content takes the panel's full width, and a scroller in it runs to
 *     the window's edge, so its bar sits on the edge (`SIDE_PANEL_SCROLLER`).
 *
 * However the panel closes (the button, Escape inside it, a page's own
 * shortcut), a keyboard inside it lands on the button. A closed panel is
 * `inert`: nothing in it takes focus or is read, and it takes no pointer.
 * The button comes first in the source, so Tab goes from it into the panel.
 *
 * From `lg` only. Below it a page opens the same content in a bottom sheet
 * from a button of its own. The slide and the content's fade are CSS
 * transitions on the app's curve, so both reduced-motion settings collapse
 * them like every other transition.
 */
import React, { useLayoutEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { DURATION } from "../../lib/motion";
import { SECTION_BG } from "../../lib/styles";
import { Badge } from "../ui/Badge";
import { RailTooltip } from "../ui/RailTooltip";

/** The panel's width. Pages that fit content beside it can read it. */
export const SIDE_PANEL_WIDTH = 320;

/**
 * How long the panel takes to open and to close, in ms: the slow and the
 * base durations, the classes below. A page that moves something with it
 * (the map eases its padding) reads them, so the two arrive together.
 */
export const SIDE_PANEL_OPEN_MS = DURATION.slow * 1000;
export const SIDE_PANEL_CLOSE_MS = DURATION.base * 1000;

/**
 * A scroller in the panel's content: it reaches the panel's side edges, so
 * its bar sits on the window's edge, and keeps the content's inset inside.
 */
export const SIDE_PANEL_SCROLLER =
  "flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 px-4 pb-4";

/**
 * Where the button and the heading row sit from the top. `page` is level
 * with a page title (Ask Contrack). `overlay` is level with a toolbar that
 * floats 16 px in, over a canvas (the map).
 */
export type SidePanelInset = "page" | "overlay";

const INSET_TOP: Record<SidePanelInset, string> = {
  page: "2rem",
  overlay: "1rem",
};

export interface SidePanelProps {
  /** The panel's id: the button's `aria-controls`. */
  id: string;
  /** The panel's name: its heading, its landmark and the button's name. */
  title: string;
  /** The button's glyph. */
  icon: LucideIcon;
  /**
   * A word beside the glyph, such as "Insights". Without one the button is
   * a square with the glyph alone.
   */
  label?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that toggles the panel, named in the button's tooltip. */
  shortcut?: string;
  /** A count after the heading. */
  count?: number;
  /**
   * The heading is for a screen reader alone. For a panel whose button
   * already names it in words, where the heading row can hold `lead`.
   */
  titleHidden?: boolean;
  /** Content at the start of the heading row, after the heading: a switch. */
  lead?: React.ReactNode;
  /** Controls in the heading row, before the button's box: Clear, a filter. */
  actions?: React.ReactNode;
  /** Where the button and the heading row sit. Default `page`. */
  inset?: SidePanelInset;
  /**
   * Attributes for the panel element, such as `data-covers-map`, which the
   * map reads to keep its pins clear of the open panel.
   */
  panelProps?: React.HTMLAttributes<HTMLElement> & {
    [attribute: `data-${string}`]: string | undefined;
  };
  children: React.ReactNode;
}

/** The button's face. The heading row reserves the same box with it. */
const buttonFace = (label: string | undefined) =>
  cn("btn-secondary btn-latch", !label && "btn-icon");

export const SidePanel = ({
  id,
  title,
  icon: Icon,
  label,
  open,
  onOpenChange,
  shortcut,
  count,
  titleHidden = false,
  lead,
  actions,
  inset = "page",
  panelProps,
  children,
}: SidePanelProps) => {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  // A panel that closes with focus inside it gives the keyboard to the
  // button that opens it again. Chrome leaves focus on an element that turns
  // inert, where Tab and the screen reader would be lost, so this runs on
  // every close, whoever closed it. Focus anywhere else stays put.
  useLayoutEffect(() => {
    if (!open && panel.current?.contains(document.activeElement)) {
      button.current?.focus();
    }
  }, [open]);

  const face = (
    <>
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      {label && <span>{label}</span>}
    </>
  );

  return (
    <div
      className="absolute inset-y-0 right-0 z-30 hidden lg:block w-80 pointer-events-none"
      style={{ "--panel-top": INSET_TOP[inset] } as React.CSSProperties}
    >
      {/* The button, over the panel's corner and in the same place open or
          closed. First in the source, so Tab goes from it into the panel. */}
      <RailTooltip
        label={title}
        shortcut={shortcut}
        side="left"
        disabled={open}
        className="absolute right-4 top-(--panel-top) z-10 pointer-events-auto"
      >
        <button
          ref={button}
          type="button"
          aria-label={title}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => onOpenChange(!open)}
          className={buttonFace(label)}
        >
          {face}
        </button>
      </RailTooltip>

      {/* The panel, from the window's edge. Escape from any control in it
          bubbles up to the panel, which listens the way a dialog does: the
          landmark is not a control. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        {...panelProps}
        ref={panel}
        id={id}
        aria-label={title}
        inert={!open}
        onKeyDown={(event) => {
          panelProps?.onKeyDown?.(event);
          if (event.key !== "Escape" || event.defaultPrevented) return;
          // The panel answers Escape first, so a page's own Escape (clear
          // the search, close the contact) does not run under it.
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }}
        className={cn(
          "side-panel absolute inset-y-0 right-0 w-80 flex flex-col",
          SECTION_BG,
          // It opens on the app's curve at the slow duration and leaves at
          // the base one, the way a sheet goes faster than it comes.
          "transition-[translate,opacity] ease-(--ease)",
          open
            ? "translate-x-0 opacity-100 duration-(--dur-slow) pointer-events-auto"
            : "translate-x-full opacity-0 pointer-events-none",
          panelProps?.className,
        )}
      >
        {/* The heading row starts level with the button. Its last box is
            the button's own face, drawn invisible, so the title and the
            actions end where the button begins at any word length. */}
        <div className="flex items-center gap-2 px-4 pt-(--panel-top) shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 min-h-10">
            <h2
              className={
                titleHidden
                  ? "sr-only"
                  : "text-base font-semibold text-on-surface truncate"
              }
            >
              {title}
            </h2>
            {!titleHidden && count !== undefined && (
              <Badge tone="neutral">{count}</Badge>
            )}
            {lead}
          </div>
          {actions}
          <span
            aria-hidden="true"
            className={cn(buttonFace(label), "invisible")}
          >
            {face}
          </span>
        </div>
        {/* The content follows the panel in, a beat behind it, and leaves
            first. */}
        <div
          className={cn(
            "flex-1 min-h-0 flex flex-col px-4 pt-4",
            "transition-[translate,opacity] ease-(--ease)",
            open
              ? "translate-x-0 opacity-100 duration-(--dur-slow) delay-75"
              : "translate-x-3 opacity-0 duration-(--dur-fast)",
          )}
        >
          {children}
        </div>
      </aside>
    </div>
  );
};
