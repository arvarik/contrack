/**
 * RouteFallback — what a lazily-loaded route shows while its chunk downloads.
 *
 * This used to be one centred "Loading…" string for every route. Because the
 * views themselves have real skeletons that only appear *after* their chunk
 * has arrived, a cold navigation to Pulse ran through four states —
 * blank → "Loading..." → skeleton → content — two of which were placeholders
 * for each other, each with a different silhouette, so the page visibly
 * reshuffled twice before settling.
 *
 * Each variant here mirrors the destination's real skeleton, so the chunk load
 * and the data load look like one continuous wait and the layout lands once.
 * Every page's top is `PageHeader`, so every variant draws the same header
 * silhouette (`PageHeaderSkeleton`) in the page's own padding, and Pulse's
 * own skeleton borrows it.
 *
 * These are deliberately dependency-free: they are imported eagerly by App, so
 * anything they touch is pulled into the entry bundle. Approximating a shape
 * in a few divs is worth more than sharing code with the lazy chunk.
 */
import React from "react";
import { cn } from "../../lib/utils";
import {
  ASK_COLUMN,
  CARD,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PAGE_TITLE_SUFFIX,
  PAGE_TOP,
  PAGE_X,
  TITLE_GRID,
  TITLE_GRID_ACTIONS,
  TITLE_GRID_DESCRIPTION,
  TITLE_GRID_SUFFIX,
  TITLE_GRID_TITLE,
} from "../../lib/styles";
// A file of class strings and type imports, so it adds no code the entry
// bundle does not already have. The page and its skeleton read the same
// constants, which is what keeps the three silhouettes one.
import {
  COLUMN_CLASSES,
  GRID_CLASSES,
} from "../../views/pulse/lib/pulseStyles";
import { storedLeftPaneWidth } from "./paneWidth";

/** Neutral pulsing block. */
const Bar = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "bg-surface-container-high/60 animate-pulse rounded-full",
      className,
    )}
  />
);

const Block = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "bg-surface-container/50 animate-pulse rounded-2xl",
      className,
    )}
  />
);

/**
 * A bar one line of `type` tall. The box is set in the words' own type, so
 * it takes the height a line of them will at every width, and the bar sits
 * in it at about the height of the letters.
 */
const TextBar = ({
  type,
  width,
  className,
}: {
  type: string;
  width: string;
  className?: string;
}) => (
  <div className={cn(type, "flex h-[1lh] items-center", className)}>
    <Bar className={cn("h-[0.7em] max-w-full", width)} />
  </div>
);

/**
 * `PageHeader` as bars: the title and its suffix, and the description in
 * their slots, gaps and line heights, the controls at the right and whatever
 * sits under them. Each text prop is the width of its bar, and a slot
 * without one is left out. No skeleton draws a back link: the one page that
 * has one, a settings page below `lg`, cannot be told from the settings
 * list while the chunk loads, and the list has none.
 */
export const PageHeaderSkeleton = ({
  title,
  suffix,
  description,
  actions,
  actionsClassName,
  children,
  className,
}: {
  title: string;
  suffix?: string;
  description?: string;
  /** Blocks the size of the page's own controls. */
  actions?: React.ReactNode;
  /** Classes on the actions' box, as `PageHeader` takes them. */
  actionsClassName?: string;
  /** Blocks for what the page puts under its title block: a search box. */
  children?: React.ReactNode;
  className?: string;
}) => (
  // A size container, like `PageHeader`, so each bar takes the same size
  // and place its text will.
  <div className={cn("@container flex flex-col gap-4", className)}>
    {suffix === undefined ? (
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex flex-1 flex-col gap-1">
          <TextBar type={PAGE_TITLE} width={title} />
          {description && (
            <TextBar type={PAGE_DESCRIPTION} width={description} />
          )}
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
    ) : (
      // The page header's grid: the suffix under the title and the actions
      // in a narrow header, beside the title from `@2xl`.
      <div className={TITLE_GRID}>
        <TextBar type={PAGE_TITLE} width={title} className={TITLE_GRID_TITLE} />
        <TextBar
          type={PAGE_TITLE_SUFFIX}
          width={suffix}
          className={TITLE_GRID_SUFFIX}
        />
        {description && (
          <TextBar
            type={PAGE_DESCRIPTION}
            width={description}
            className={TITLE_GRID_DESCRIPTION}
          />
        )}
        {actions && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-3",
              TITLE_GRID_ACTIONS,
            )}
          >
            {actions}
          </div>
        )}
      </div>
    )}
    {children}
  </div>
);

/**
 * Pulse's masthead as bars: "Pulse" and the date on one line, the sentence,
 * then Log note and the More menu. The route fallback and `PulseSkeleton`
 * both draw this one.
 */
export const PulseHeaderSkeleton = () => (
  <PageHeaderSkeleton
    title="w-16 md:w-20"
    suffix="w-60 md:w-80"
    description="w-72 sm:w-96"
    actions={
      <>
        <Block className="w-30 h-11 sm:h-10 rounded-xl" />
        <Block className="w-9 h-9 rounded-xl" />
      </>
    }
  />
);

export type RouteFallbackVariant = "pulse" | "search" | "settings" | "map";

/**
 * @param variant which destination is loading — picks the matching silhouette
 */
export const RouteFallback = ({
  variant,
}: {
  variant: RouteFallbackVariant;
}) => {
  if (variant === "map") {
    // The map paints edge to edge, so anything with padding would be a lie.
    return (
      <div className="h-full w-full bg-surface-container-low animate-pulse" />
    );
  }

  if (variant === "pulse") {
    // Mirrors PulseSkeleton: the masthead and the three columns from the
    // same class constants as the page.
    return (
      <div className="w-full h-full overflow-hidden bg-surface">
        <div
          className={cn(
            "max-w-[1600px] mx-auto flex flex-col gap-6 sm:gap-8",
            PAGE_X,
            PAGE_TOP,
          )}
        >
          <PulseHeaderSkeleton />
          <div className={GRID_CLASSES}>
            <div
              className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.focus)}
            >
              <Block className="h-[400px] lg:min-h-[25rem] lg:h-[calc(100dvh-12rem)]" />
              <Block className="h-[39px]" />
            </div>
            <div
              className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.intel)}
            >
              {/* Daily insight at the height PulseSkeleton gives a typical
                  insight in this column at each width: a card with a key,
                  the common case. A fixed 140 px block jumped to the card. */}
              <Block className="h-[293px] lg:h-[252px] xl:h-[349px]" />
              <Block className="h-[160px]" />
              <Block className="h-[140px]" />
              <Block className="h-[437px]" />
            </div>
            <div
              className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.network)}
            >
              <Block className="h-[166px]" />
              <Block className="h-[410px] lg:h-[466px] xl:h-[410px]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "search") {
    // Ask Contrack: the title with the mode switch, and History below `lg`
    // (the pair fills its own row on a phone), the search box, then "Try
    // asking" and its chips, in the page's column and with the scroller's
    // bar lane. From `lg` the History button is in the top-right corner. Its
    // panel opens over the page, so the column is where it lands either way.
    return (
      <div className="relative h-full flex overflow-hidden bg-surface">
        <div className="flex-1 min-w-0 overflow-hidden [scrollbar-gutter:stable]">
          <div
            className={cn(
              ASK_COLUMN,
              "px-4 sm:px-6 space-y-6 sm:space-y-8",
              PAGE_TOP,
            )}
          >
            <PageHeaderSkeleton
              title="w-44"
              actionsClassName="max-sm:w-full"
              actions={
                <>
                  <Block className="max-sm:flex-1 sm:w-36 h-13 sm:h-10 rounded-xl" />
                  <Block className="w-11 h-11 rounded-xl lg:hidden" />
                </>
              }
            />
            <Block className="h-31 sm:h-20 rounded-2xl bg-surface-container-lowest" />
            <div className="space-y-3">
              <Bar className="h-3 w-20" />
              <div className="flex flex-wrap gap-2">
                {["w-80", "w-40", "w-76", "w-68", "w-60"].map((width) => (
                  <Block
                    key={width}
                    className={cn(
                      "h-9 rounded-md bg-surface-container-lowest max-w-full",
                      width,
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        <Block className="hidden lg:block absolute right-4 top-8 w-10 h-10 rounded-md" />
      </div>
    );
  }

  // settings: the rail from lg, then the header and the page in the page's
  // centred box. The list has no back link, and from lg no page has one.
  return (
    <div className="h-full flex overflow-hidden bg-surface">
      <div
        className="hidden lg:block shrink-0 h-full bg-surface-container-low"
        style={{ width: storedLeftPaneWidth() }}
      />
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        <PageHeaderSkeleton
          title="w-36"
          className={cn(PAGE_X, PAGE_TOP, "w-full max-w-4xl mx-auto shrink-0")}
        />
        <div className={cn(PAGE_X, "pt-4 w-full max-w-4xl mx-auto space-y-8")}>
          {[3, 2].map((rows, group) => (
            <section key={group} className="space-y-2">
              <Bar className="h-3 w-24" />
              <div className={cn(CARD, "p-0 overflow-hidden")}>
                {Array.from({ length: rows }, (_, i) => (
                  <div key={i} className="flex items-center gap-3.5 p-4 sm:p-5">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Bar className="h-3.5 w-40" />
                      <Bar className="h-3 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
