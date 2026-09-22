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
  CARD,
  PAGE_DESCRIPTION,
  PAGE_EYEBROW,
  PAGE_TITLE,
  PAGE_TOP,
  PAGE_X,
} from "../../lib/styles";
// A file of class strings and type imports, so it adds no code the entry
// bundle does not already have. The page and its skeleton read the same
// constants, which is what keeps the three silhouettes one.
import {
  COLUMN_CLASSES,
  GRID_CLASSES,
} from "../../views/pulse/lib/pulseStyles";

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
 * `PageHeader` as bars: the eyebrow, the title and the description in its
 * slots, gaps and line heights, the controls at the right and whatever sits
 * under them. Each text prop is the width of its bar, and a slot without
 * one is left out.
 */
export const PageHeaderSkeleton = ({
  eyebrow,
  eyebrowClassName,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: string;
  /** Classes on the eyebrow's line: `hidden lg:flex` for a back link only wide screens show. */
  eyebrowClassName?: string;
  title: string;
  description?: string;
  /** Blocks the size of the page's own controls. */
  actions?: React.ReactNode;
  /** Blocks for what the page puts under its title block: a search box. */
  children?: React.ReactNode;
  className?: string;
}) => (
  // A size container, like `PageHeader`, so the title bar takes the same
  // size the title will.
  <div className={cn("@container flex flex-col gap-4", className)}>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex flex-1 flex-col gap-1">
        {eyebrow && (
          <TextBar
            type={PAGE_EYEBROW}
            width={eyebrow}
            className={eyebrowClassName}
          />
        )}
        <TextBar type={PAGE_TITLE} width={title} />
        {description && <TextBar type={PAGE_DESCRIPTION} width={description} />}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
    {children}
  </div>
);

/**
 * Pulse's masthead as bars: "Pulse", the date and the sentence, then the
 * progress mark with its words, Log a note and the More menu. The route
 * fallback and `PulseSkeleton` both draw this one.
 *
 * @param ask whether the Ask form is under the masthead. It is from `sm`
 *   whenever AI is allowed, which is the default, so the route fallback,
 *   which knows no preferences, draws it.
 */
export const PulseHeaderSkeleton = ({ ask = true }: { ask?: boolean }) => (
  <PageHeaderSkeleton
    eyebrow="w-10"
    title="w-64 sm:w-80"
    description="w-72 sm:w-96"
    actions={
      <>
        <div className="flex items-center gap-2">
          <Block className="w-10 h-10 rounded-full" />
          <Bar className="h-3 w-16" />
        </div>
        <Block className="w-34 h-11 sm:h-10 rounded-xl" />
        <Block className="w-9 h-9 rounded-xl" />
      </>
    }
  >
    {ask && (
      <div className="hidden sm:flex items-center gap-2 w-full max-w-xl">
        <Block className="flex-1 h-10 rounded-xl" />
        <Block className="w-18 h-10 rounded-xl" />
      </div>
    )}
  </PageHeaderSkeleton>
);

export type RouteFallbackVariant =
  "pulse" | "search" | "settings" | "tracked" | "map";

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
              <Block className="h-[400px]" />
              <Block className="h-[60px]" />
            </div>
            <div
              className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.intel)}
            >
              <Block className="h-[140px] bg-primary/5" />
              <Block className="h-[160px]" />
              <Block className="h-[140px]" />
              <Block className="h-[100px]" />
            </div>
            <div
              className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.network)}
            >
              <Block className="h-[130px]" />
              <Block className="h-[130px]" />
              <Block className="h-[130px]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "search") {
    // The header sits in the results column, above the scroller, with the
    // column's own gutters: the title, the line under it, the mode switch
    // and the history button.
    return (
      <div className="h-full flex flex-col overflow-hidden bg-surface">
        <PageHeaderSkeleton
          title="w-44"
          description="w-72"
          actions={
            <>
              <Block className="w-full sm:w-36 h-11 sm:h-9 rounded-lg" />
              <Block className="w-9 h-9 rounded-xl" />
            </>
          }
          className={cn(
            "max-w-3xl w-full mx-auto px-4 sm:px-6 shrink-0",
            PAGE_TOP,
          )}
        />
        <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <Block className="h-[68px] bg-surface-container-lowest" />
          <Bar className="h-3 w-28" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Block key={i} className="h-12 bg-surface-container-lowest" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "tracked") {
    // The Tracked contacts page: its header, the search row and the list,
    // in one centred box.
    return (
      <div className="h-full overflow-hidden bg-surface">
        <div className={cn(PAGE_X, PAGE_TOP, "max-w-4xl mx-auto space-y-5")}>
          <PageHeaderSkeleton title="w-52" description="w-full sm:w-[36rem]" />
          <Block className="h-11 sm:h-10 rounded-xl" />
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <div className="w-9 h-9 rounded-full bg-surface-container-high/60 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <Bar className="h-3.5 w-40" />
                  <Bar className="h-3 w-56 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // settings: the rail from lg, then the header and the page in the page's
  // centred box. From lg the header has a back link to the Network.
  return (
    <div className="h-full flex overflow-hidden bg-surface">
      <div className="hidden lg:block w-[240px] shrink-0 h-full bg-surface-container-low" />
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        <PageHeaderSkeleton
          eyebrow="w-16"
          eyebrowClassName="hidden lg:flex"
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
