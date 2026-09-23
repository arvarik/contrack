/**
 * SidePanel: the one right-hand panel, a slim rail and the panel it opens.
 *
 * The Ask history and the map's insights were two panels with two looks and
 * two behaviours. One pushed the page's column aside when it opened, so the
 * search box jumped. The other hid behind a floating button. Both are this
 * now, the left nav's mirror at the right edge:
 *
 *   - The rail, 64 px, the nav's width and surface, holds the panel's icon.
 *     It is part of the layout, so the page centres in the space beside it
 *     once and never moves again.
 *   - The panel, 320 px, slides out from under the rail, over the page. It
 *     is an overlay, so opening it moves nothing under it. It wears the
 *     rail's surface and a soft shadow on its open edge.
 *
 * The rail's icon is a disclosure (`aria-expanded`, `aria-controls`), named
 * for the panel. The panel's heading row names it, shows a count, holds its
 * actions and ends with Hide. However the panel closes (Hide, Escape inside
 * it, a page's own shortcut), a keyboard inside it lands on the rail's icon.
 * A closed panel is `inert`: nothing in it takes focus or is read, and it
 * takes no pointer.
 *
 * From `lg` only. Below it a page opens the same content in a bottom sheet.
 * The slide is a CSS transition on the app's curve, so both reduced-motion
 * settings collapse it like every other transition.
 */
import React, { useLayoutEffect, useRef } from "react";
import { PanelRightClose, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { ICON_BTN, navLink, PAGE_TOP, SECTION_BG } from "../../lib/styles";
import { Badge } from "../ui/Badge";
import { RailTooltip } from "../ui/RailTooltip";

/** The panel's width. Pages that fit content beside it can read it. */
export const SIDE_PANEL_WIDTH = 320;

export interface SidePanelProps {
  /** The panel's id: the rail icon's `aria-controls`. */
  id: string;
  /** The panel's name: its heading, its landmark and its rail icon. */
  title: string;
  /** The rail's glyph for the panel. */
  icon: LucideIcon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that toggles the panel, named in the tooltips. */
  shortcut?: string;
  /** A count after the heading. */
  count?: number;
  /** Controls in the heading row, before Hide: Clear, a filter. */
  actions?: React.ReactNode;
  /**
   * Attributes for the panel element, such as `data-covers-map`, which the
   * map reads to keep its pins clear of the open panel.
   */
  panelProps?: React.HTMLAttributes<HTMLElement> & {
    [attribute: `data-${string}`]: string | undefined;
  };
  children: React.ReactNode;
}

export const SidePanel = ({
  id,
  title,
  icon: Icon,
  open,
  onOpenChange,
  shortcut,
  count,
  actions,
  panelProps,
  children,
}: SidePanelProps) => {
  const railButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const hideLabel = `Hide ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  const close = () => onOpenChange(false);

  // A panel that closes with focus inside it gives the keyboard to the icon
  // that opens it again. Chrome leaves focus on an element that turns
  // inert, where Tab and the screen reader would be lost, so this runs on
  // every close, whoever closed it. Focus anywhere else stays put.
  useLayoutEffect(() => {
    if (!open && panel.current?.contains(document.activeElement)) {
      railButton.current?.focus();
    }
  }, [open]);

  return (
    <div className="relative hidden lg:flex shrink-0 h-full z-30">
      {/* The rail. It paints over the panel, so the panel slides out from
          under it. */}
      <div
        className={cn(
          SECTION_BG,
          "relative z-10 w-16 h-full flex flex-col items-center pt-6",
        )}
      >
        <RailTooltip
          label={title}
          shortcut={shortcut}
          side="left"
          disabled={open}
        >
          <button
            ref={railButton}
            type="button"
            aria-label={title}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => onOpenChange(!open)}
            className={navLink(open)}
          >
            <Icon className="w-6 h-6" aria-hidden="true" />
          </button>
        </RailTooltip>
      </div>

      {/* The panel, over the page, from the rail's open edge. Later in the
          source than the rail, so Tab goes from the icon into the panel.
          Escape from any control in it bubbles up to the panel, which
          listens the way a dialog does: the landmark is not a control. */}
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
          close();
        }}
        className={cn(
          "side-panel absolute top-0 bottom-0 right-full w-80 flex flex-col",
          SECTION_BG,
          "transition-[translate,opacity] duration-(--dur-slow) ease-(--ease)",
          open
            ? "translate-x-0 opacity-100"
            : "translate-x-6 opacity-0 pointer-events-none",
          panelProps?.className,
        )}
      >
        {/* The heading row starts level with the page's title. */}
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-4 pb-3 shrink-0",
            PAGE_TOP,
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold text-on-surface truncate">
              {title}
            </h2>
            {count !== undefined && <Badge tone="neutral">{count}</Badge>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button
              type="button"
              onClick={close}
              aria-label={hideLabel}
              title={shortcut ? `${hideLabel} (${shortcut})` : hideLabel}
              className={cn(ICON_BTN, "-mr-2")}
            >
              <PanelRightClose className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          {children}
        </div>
      </aside>
    </div>
  );
};
