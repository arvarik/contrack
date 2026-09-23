import React from "react";
import { cn } from "../../../lib/utils";
import { CARD, PAGE_TOP, PAGE_X } from "../../../lib/styles";
import { PulseHeaderSkeleton } from "../../../components/layout/RouteFallback";
import { COLUMN_CLASSES, GRID_CLASSES, PULSE_TYPE } from "../lib/pulseStyles";

const SkeletonBox = ({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) => (
  <div
    className={cn(
      "bg-surface-container/50 animate-pulse rounded-2xl",
      className,
    )}
  >
    {children}
  </div>
);

const SkeletonLine = ({
  className,
  width = "w-full",
}: {
  className?: string;
  width?: string;
}) => (
  <div
    className={cn(
      "h-3.5 bg-surface-container-highest/60 animate-pulse rounded-full",
      width,
      className,
    )}
  />
);

/**
 * Words drawn as bars. The words are there in a transparent ink, so the bars
 * wrap where the loaded line's words wrap, one bar for each line of text. A
 * screen reader skips them: they are a shape, not the page's words.
 */
export const SkeletonWords = ({
  className,
  children,
}: {
  className?: string;
  children: string;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "text-transparent select-none rounded bg-surface-container-highest/60 animate-pulse [box-decoration-break:clone]",
      className,
    )}
  >
    {children}
  </span>
);

/**
 * An insight of a common length, the shape of the paragraph before its words
 * arrive. The model writes one or two sentences, and they run to about 300
 * characters: this one is 308, the one it wrote on the seed data 320.
 */
const TYPICAL_INSIGHT =
  "Most of the people you added this month have no follow-up yet, and your time goes to the same few names while three of your strongest ties, all founders you met at the spring summit, have been quiet for more than two months. A short note to each of them this week would keep those ties warm before they fade.";

/**
 * The body of the insight card before its words arrive: the category and the
 * paragraph, in the loaded card's own layout and type, as bars. The skeleton
 * and the card's loading state draw it, so the card lands at about the
 * height it will have.
 *
 * @param text the insight's words once they are back, for the exact height.
 */
export const InsightPlaceholder = ({
  text = TYPICAL_INSIGHT,
}: {
  text?: string;
}) => (
  <div className="flex flex-col gap-1.5">
    <p className={PULSE_TYPE.meta}>
      <SkeletonWords>Relationship maintenance</SkeletonWords>
    </p>
    <p className={cn(PULSE_TYPE.insight, "text-pretty")}>
      <SkeletonWords>{text}</SkeletonWords>
    </p>
  </div>
);

/**
 * The page's silhouette while the dashboard loads. It reads the same padding,
 * grid and column classes as the page and the route fallback, and draws the
 * route fallback's masthead, so the header and the columns land once at
 * every width.
 *
 * @param insight what the page knows of the day's insight: its words once
 *   they are back, `null` when there is none to draw (AI is off, or it came
 *   back empty), and nothing while it is on its way. With AI on an insight
 *   is the likely answer, so only `null` draws the line.
 */
export const PulseSkeleton = ({ insight }: { insight?: string | null }) => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading Pulse"
      className={cn(
        "w-full max-w-[1600px] mx-auto flex flex-col gap-6 sm:gap-8 pb-32",
        PAGE_X,
        PAGE_TOP,
      )}
    >
      <PulseHeaderSkeleton />

      {/* 3-Column Grid Skeleton */}
      <div className={GRID_CLASSES}>
        {/* Column 1: Focus */}
        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.focus)}>
          <div
            // From `lg` the loaded card is its header over a pane capped at
            // `100dvh - 17rem` (UpNextCard), about `100dvh - 12rem` in all.
            className={cn(
              CARD,
              "p-4 sm:p-5 flex flex-col gap-4 min-h-[400px] lg:min-h-[25rem] lg:h-[calc(100dvh-12rem)]",
            )}
          >
            <div className="flex items-center justify-between">
              <SkeletonLine width="w-24" className="h-5" />
              <SkeletonBox className="w-8 h-4 rounded-md" />
            </div>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="p-3.5 rounded-xl bg-surface-container-low/60 flex items-center gap-3"
              >
                <SkeletonBox className="w-6 h-6 rounded-full shrink-0" />
                <SkeletonBox className="w-8 h-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <SkeletonLine width="w-28" />
                  <SkeletonLine width="w-48" className="h-3" />
                </div>
              </div>
            ))}
          </div>

          {/* Completed is a line on the page surface, not a card. */}
          <div className="px-4 sm:px-5 py-2 min-h-[39px] flex items-center">
            <SkeletonLine width="w-48" className="h-4" />
          </div>
        </div>

        {/* Column 2: Intelligence */}
        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.intel)}>
          {/* Daily insight, in the loaded shape's own layout and words, so
              it wraps to the loaded height: the card with its paragraph,
              or the line when there is no insight to draw. A fixed 140 px
              card here sat over an 82 px line without a key and a 389 px
              card with one, and the column jumped when the page loaded. */}
          {insight === null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 py-2">
              <div className={cn(PULSE_TYPE.cardTitle, "min-w-0")}>
                <SkeletonWords>Daily insight</SkeletonWords>
              </div>
              <div className={cn(PULSE_TYPE.meta, "min-w-0")}>
                <SkeletonWords>
                  Add an AI key to get one. Open AI settings
                </SkeletonWords>
              </div>
            </div>
          ) : (
            <div className={cn(CARD, "p-0")}>
              <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-4">
                <div className="flex items-center min-h-6">
                  <span className={PULSE_TYPE.cardTitle}>
                    <SkeletonWords>Daily insight</SkeletonWords>
                  </span>
                </div>
              </div>
              <div className="px-4 sm:px-5 pb-4 sm:pb-5">
                <InsightPlaceholder text={insight} />
              </div>
            </div>
          )}

          <div
            className={cn(CARD, "p-4 sm:p-5 min-h-[160px] flex flex-col gap-3")}
          >
            <SkeletonLine width="w-20" className="h-4" />
            <SkeletonBox className="h-10 rounded-xl" />
            <SkeletonBox className="h-10 rounded-xl" />
          </div>

          <div className={cn(CARD, "p-4 sm:p-5 min-h-[140px]")}>
            <SkeletonLine width="w-28" className="h-4 mb-3" />
            <SkeletonBox className="h-12 rounded-xl" />
          </div>

          <div className={cn(CARD, "p-4 sm:p-5 min-h-[437px]")}>
            <SkeletonLine width="w-24" className="h-4 mb-3" />
            <SkeletonBox className="h-12 rounded-xl" />
          </div>
        </div>

        {/* Column 3: Network (Keeping up, Activity) */}
        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.network)}>
          {/* Keeping up, then Activity with its heatmap, at the heights
              they load at. */}
          {/* The heatmap grows with its column: 7 of 12 at `lg`. */}
          {[
            "min-h-[166px]",
            "min-h-[410px] lg:min-h-[466px] xl:min-h-[410px]",
          ].map((height) => (
            <div
              key={height}
              className={cn(
                CARD,
                "p-4 sm:p-5 flex flex-col justify-between",
                height,
              )}
            >
              <SkeletonLine width="w-24" className="h-4" />
              <div className="flex items-center justify-between">
                <div>
                  <SkeletonLine width="w-16" className="h-7 mb-1" />
                  <SkeletonLine width="w-28" className="h-3" />
                </div>
                <SkeletonBox className="w-10 h-10 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
