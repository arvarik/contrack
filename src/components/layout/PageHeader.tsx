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
 *   back link or eyebrow                                 actions
 *   Title
 *   One line of description
 *   children (a search box, filters, a form)
 *
 * The title is the `h1` unless a page says otherwise. Pulse keeps the day as
 * its headline: its eyebrow "Pulse" is the `h1` and the date is the title in
 * a `p`, in the same slots and sizes as every other page. The Network list
 * uses an `h2` when an open contact's name is the page's `h1`.
 *
 * No band, no icon tile and no border: the header sits on the page's own
 * surface. The page owns the padding (`PAGE_X`, `PAGE_TOP` in
 * `src/lib/styles.ts`), so every title starts the same distance from the top.
 *
 * The header is a size container (`@container`): the title and the
 * description grow a step when the header, not the window, is wide. The
 * Network list is a narrow pane beside a contact on a desktop, and it keeps
 * the phone sizes there. A header sits in a column, full width, so the
 * inline-size containment costs nothing.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "../../lib/utils";
import { PAGE_DESCRIPTION, PAGE_EYEBROW, PAGE_TITLE } from "../../lib/styles";

export interface PageHeaderProps {
  /** The page's name, or the headline when `eyebrowAs` is `"h1"`. */
  title: React.ReactNode;
  /** The title's element. `h1` by default. */
  titleAs?: "h1" | "h2" | "p";
  /** One line under the title. */
  description?: React.ReactNode;
  /** Controls at the right edge of the title block. */
  actions?: React.ReactNode;
  /**
   * Classes on the actions' box, for a page whose controls should fill the
   * row when they wrap under the title on a phone (`max-sm:w-full`).
   */
  actionsClassName?: string;
  /** A small line above the title: the page's name over a headline. */
  eyebrow?: React.ReactNode;
  /** The eyebrow's element. `"h1"` when the title is a headline, not a name. */
  eyebrowAs?: "p" | "h1";
  /** A link back to the parent page, drawn as the eyebrow. */
  back?: { to: string; label: string };
  /** A name for the header, for a page with more than one header region. */
  label?: string;
  /** Under the title block: a search box, filters or a form. */
  children?: React.ReactNode;
  className?: string;
}

/** The back link: a chevron and the parent page's name, in the eyebrow's type. */
const BACK_LINK = cn(
  PAGE_EYEBROW,
  "hit-area inline-flex items-center gap-1 w-fit rounded-md -ml-1 pr-1 hover:text-on-surface transition-colors",
);

export const PageHeader = ({
  title,
  titleAs: Title = "h1",
  description,
  actions,
  actionsClassName,
  eyebrow,
  eyebrowAs: Eyebrow = "p",
  back,
  label,
  children,
  className,
}: PageHeaderProps) => (
  <header
    aria-label={label}
    className={cn("@container flex flex-col gap-4", className)}
  >
    {/* The row aligns to the top, so every page's title starts at the same
        height whatever sits beside it. */}
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      {/* The title block grows into the row and shrinks to its longest
          word (no `min-w-0`, on purpose), so the actions stay at the right
          and the sentence wraps beside them. They drop under the block only
          when that word and the actions do not fit one row: a phone. */}
      <div className="flex flex-1 flex-col gap-1">
        {back && (
          // Named "Back to …", like every back control in the app: the
          // sidebar has a link with the parent's bare name too.
          <Link
            to={back.to}
            aria-label={`Back to ${back.label}`}
            className={BACK_LINK}
          >
            <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        {eyebrow !== undefined && (
          <Eyebrow className={PAGE_EYEBROW}>{eyebrow}</Eyebrow>
        )}
        <Title className={cn(PAGE_TITLE, "min-w-0 break-words")}>{title}</Title>
        {description && <p className={PAGE_DESCRIPTION}>{description}</p>}
      </div>
      {actions && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 sm:shrink-0",
            actionsClassName,
          )}
        >
          {actions}
        </div>
      )}
    </div>
    {children}
  </header>
);
