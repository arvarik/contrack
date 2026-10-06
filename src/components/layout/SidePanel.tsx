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
 *   - The button is a square `.btn-secondary` with the panel's glyph, a
 *     disclosure (`aria-expanded`, `aria-controls`). While the panel is open
 *     it stays pressed in (`.btn-latch`), and it is the only close button.
 *   - The panel, 320 px, has its heading row level with the button, the
 *     button's box kept free at its end. `titleHidden` and `lead` give the
 *     row to a control. A scroller in the content reaches the window's edge
 *     (`SIDE_PANEL_SCROLLER`).
 *
 * However the panel closes, a keyboard inside it lands on the button. A
 * closed panel is `inert`. The button comes first in the source, so Tab
 * goes from it into the panel.
 *
 * From `lg` only: below it a page opens the content in a bottom sheet. The
 * slide and fade are CSS transitions, so reduced motion collapses them.
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
 * How long the panel takes to open and to close, in ms, for a page that
 * moves something with it (the map eases its padding).
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
type SidePanelInset = "page" | "overlay";

const INSET_TOP: Record<SidePanelInset, string> = {
  page: "2rem",
  overlay: "1rem",
};

interface SidePanelProps {
  /** The panel's id: the button's `aria-controls`. */
  id: string;
  /** The panel's name: its heading, its landmark and the button's name. */
  title: string;
  /** The button's glyph. */
  icon: LucideIcon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that toggles the panel, named in the button's tooltip. */
  shortcut?: string;
  /** A count after the heading. */
  count?: number;
  /**
   * The heading is for a screen reader alone, and the row gives its room to
   * `lead`: the map's Summary and People switch, whose words and content
   * already say what the panel is.
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
const BUTTON_FACE = "btn-secondary btn-latch btn-icon";

export const SidePanel = ({
  id,
  title,
  icon: Icon,
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

  // A panel that closes with focus inside it gives the focus to its button:
  // Chrome leaves focus on an element that turns inert. Focus anywhere else
  // stays put.
  useLayoutEffect(() => {
    if (!open && panel.current?.contains(document.activeElement)) {
      button.current?.focus();
    }
  }, [open]);

  const face = <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />;

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
          className={BUTTON_FACE}
        >
          {face}
        </button>
      </RailTooltip>

      {/* The panel. Escape from any control in it bubbles up to the panel,
          which listens as a dialog does. */}
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
        {/* The heading row's last box is an invisible copy of the button's
            face, so the title and actions end where the button begins. */}
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
          <span aria-hidden="true" className={cn(BUTTON_FACE, "invisible")}>
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
