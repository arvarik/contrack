/**
 * PageHeader: the top of every page, in one layout.
 *
 * Six pages drew six headers: a title beside icon buttons, a 13 px label
 * over a 32 px date, an icon tile with a title on a grey band, the same on a
 * band with a bottom border, a title over an intro, and a back link over an
 * icon tile. The titles sat at different heights and sizes, so moving between
 * pages moved the eye.
 *
 * One layout now:
 *
 *   back link                                            actions
 *   Title  suffix
 *   One line of description
 *   children (a search box, filters, a form)
 *
 * The title is the page's name and its `h1`, the same size and ink on every
 * page. A suffix continues the title line in the variant ink, at the same
 * size, for the one fact a page leads with: on Pulse, the day. In a narrow
 * header the suffix takes its own line under the title and the actions
 * (`TITLE_GRID`). The Network list uses an `h2` when an open contact's name
 * is the page's `h1`.
 *
 * No band, no icon tile and no border: the header sits on the page's own
 * surface. The page owns the padding (`PAGE_X`, `PAGE_TOP` in
 * `src/lib/styles.ts`), so every title starts the same distance from the top.
 *
 * The title is 24 px on a phone and 30 px from `md` on every page, the
 * narrow Network pane too. The header is a size container (`@container`)
 * for the rest: the description grows a step, and a suffix moves up onto the
 * title's line, when the header, not the window, is wide. A header sits in
 * a column, full width, so the inline-size containment costs nothing.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "../../lib/utils";
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

export interface PageHeaderProps {
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
}: PageHeaderProps) => {
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
        // The row aligns to the top, so every page's title starts at the
        // same height whatever sits beside it.
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          {/* The title block grows into the row and shrinks to its longest
              word (no `min-w-0`, on purpose), so the actions stay at the
              right and the sentence wraps beside them. They drop under the
              block only when that word and the actions do not fit one row:
              a phone. */}
          <div className="flex flex-1 flex-col gap-1">
            {backLink}
            <Title className={TITLE}>{title}</Title>
            {description && <p className={PAGE_DESCRIPTION}>{description}</p>}
          </div>
          {actions && (
            <div className={cn(ACTIONS, "sm:shrink-0", actionsClassName)}>
              {actions}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {backLink}
          {/* The source order stays title, suffix, description, actions,
              the same as the row above: the grid moves the cells, not the
              reading order. */}
          <div className={TITLE_GRID}>
            <Title className={cn(TITLE, TITLE_GRID_TITLE)}>{title}</Title>
            <p className={cn(PAGE_TITLE_SUFFIX, TITLE_GRID_SUFFIX)}>{suffix}</p>
            {description && (
              <p className={cn(PAGE_DESCRIPTION, TITLE_GRID_DESCRIPTION)}>
                {description}
              </p>
            )}
            {actions && (
              <div
                className={cn(ACTIONS, TITLE_GRID_ACTIONS, actionsClassName)}
              >
                {actions}
              </div>
            )}
          </div>
        </div>
      )}
      {children}
    </header>
  );
};
