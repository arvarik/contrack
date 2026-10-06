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

/** Words in transparent ink, so the bars wrap where the loaded words wrap. */
const SkeletonWords = ({ children }: { children: string }) => (
  <span
    aria-hidden="true"
    className="text-transparent select-none rounded bg-surface-container-highest/60 animate-pulse [box-decoration-break:clone]"
  >
    {children}
  </span>
);

/** An insight of a typical length: the model writes about 300 characters. */
const TYPICAL_INSIGHT =
  "Most of the people you added this month have no follow-up yet, and your time goes to the same few names while three of your strongest ties, all founders you met at the spring summit, have been quiet for more than two months. A short note to each of them this week would keep those ties warm before they fade";

/**
 * The insight card's body as bars, in the loaded card's layout and type, so
 * the card lands at about its final height.
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
 * The page's silhouette while it loads. It shares the page's padding, grid
 * and column classes, so the header and the columns land once at every width.
 *
 * @param insight the insight's words once back, `null` when there is none
 *   (AI off, or empty), and undefined while it loads. Only `null` draws the
 *   line shape.
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

      <div className={GRID_CLASSES}>
        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.focus)}>
          <div
            // From `lg` UpNextCard's pane is capped, about `100dvh - 12rem`.
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

        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.intel)}>
          {/* The loaded shape, so the column does not jump on load. */}
          {insight === null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 py-2">
              <div className={cn(PULSE_TYPE.cardTitle, "min-w-0")}>
                <SkeletonWords>Daily insight</SkeletonWords>
              </div>
              <div className={cn(PULSE_TYPE.meta, "min-w-0")}>
                <SkeletonWords>
                  Set up a Fast model to get one. Open AI settings
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

        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.network)}>
          {/* Keeping up, then Activity, whose heatmap grows at `lg`. */}
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
