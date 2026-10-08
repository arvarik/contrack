/**
 * The top of every page, in one layout:
 *
 *   back link
 *   Title  suffix                                        actions
 *   One line of description
 *   children (a search box, filters, a form)
 *
 * The title is the page's `h1`, the same on every page (an `h2` in the
 * Network list when an open contact's name is the `h1`). A suffix is the one
 * fact a page leads with, such as the day on Pulse. In a narrow header it
 * takes its own line (`TITLE_GRID`).
 *
 * No band, tile or border. The page owns the padding (`PAGE_X`, `PAGE_TOP`).
 * The title is 24 px on a phone and 30 px from `md`. The header is a size
 * container, so the description and suffix follow the header's width, not
 * the window's.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "../../lib/utils";
import { PaletteButton } from "../command-palette/PaletteButton";
import {
  PAGE_DESCRIPTION,
  PAGE_EYEBROW,
  PAGE_TITLE,
  PAGE_TITLE_SUFFIX,
  TITLE_GRID,
  TITLE_GRID_ACTIONS,
  TITLE_GRID_DESCRIPTION,
  TITLE_GRID_SUFFIX,
  TITLE_GRID_TITLE,
} from "../../lib/styles";

interface PageHeaderProps {
  /** The page's name. */
  title: React.ReactNode;
  /** The title's element. `h1` by default, `h2` beside another `h1`. */
  titleAs?: "h1" | "h2";
  /**
   * The title line's second part, in the variant ink at the title's size:
   * the one fact the page leads with, such as the day on Pulse. Not part of
   * the heading, so the heading's name stays the page's name.
   */
  suffix?: React.ReactNode;
  /** One line under the title. */
  description?: React.ReactNode;
  /** Controls at the right edge of the title block. */
  actions?: React.ReactNode;
  /**
   * Classes on the actions' box, for a page whose controls should fill the
   * row when they wrap under the title on a phone (`max-sm:w-full`).
   */
  actionsClassName?: string;
  /** A link back to the parent page, in small type above the title. */
  back?: { to: string; label: string };
  /** A name for the header, for a page with more than one header region. */
  label?: string;
  /** Under the title block: a search box, filters or a form. */
  children?: React.ReactNode;
  /**
   * The command palette's button before the actions, on a touch screen
   * (`PaletteButton`). On by default, so a phone opens it from any page.
   */
  palette?: boolean;
  className?: string;
}

/** The back link: a chevron and the parent page's name, in small type. */
const BACK_LINK = cn(
  PAGE_EYEBROW,
  "hit-area inline-flex items-center gap-1 w-fit rounded-md -ml-1 pr-1 hover:text-on-surface transition-colors",
);

const TITLE = cn(PAGE_TITLE, "min-w-0 break-words");

const ACTIONS = "flex flex-wrap items-center gap-3";

export const PageHeader = ({
  title,
  titleAs: Title = "h1",
  suffix,
  description,
  actions,
  actionsClassName,
  back,
  label,
  children,
  className,
  palette = true,
}: PageHeaderProps) => {
  const allActions = (palette || actions) && (
    <>
      {palette && <PaletteButton />}
      {actions}
    </>
  );
  const backLink = back && (
    // Named "Back to …", like every back control in the app: the sidebar
    // has a link with the parent's bare name too.
    <Link
      to={back.to}
      aria-label={`Back to ${back.label}`}
      className={BACK_LINK}
    >
      <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
      {back.label}
    </Link>
  );
  return (
    <header
      aria-label={label}
      className={cn("@container flex flex-col gap-4", className)}
    >
      {suffix === undefined ? (
        <div className="flex flex-col gap-1">
          {backLink}
          {/* Top-aligned, so every title starts at the same height. The
              title shrinks to its longest word (no `min-w-0`, on purpose),
              so the actions drop under it only when both do not fit. The
              palette's button stays on the title's line, so a phone's
              wrapped actions never start with it. */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="flex-1 flex items-start justify-between gap-3">
              <Title className={TITLE}>{title}</Title>
              {palette && <PaletteButton />}
            </div>
            {actions && (
              <div className={cn(ACTIONS, "sm:shrink-0", actionsClassName)}>
                {actions}
              </div>
            )}
          </div>
          {/* Under the row, at the page's width. */}
          {description && <p className={PAGE_DESCRIPTION}>{description}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {backLink}
          {/* The grid moves the cells, not the reading order. */}
          <div className={TITLE_GRID}>
            <Title className={cn(TITLE, TITLE_GRID_TITLE)}>{title}</Title>
            <p className={cn(PAGE_TITLE_SUFFIX, TITLE_GRID_SUFFIX)}>{suffix}</p>
            {description && (
              <p className={cn(PAGE_DESCRIPTION, TITLE_GRID_DESCRIPTION)}>
                {description}
              </p>
            )}
            {allActions && (
              <div
                className={cn(ACTIONS, TITLE_GRID_ACTIONS, actionsClassName)}
              >
                {allActions}
              </div>
            )}
          </div>
        </div>
      )}
      {children}
    </header>
  );
};
