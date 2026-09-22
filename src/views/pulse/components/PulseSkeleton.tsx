import React from "react";
import { cn } from "../../../lib/utils";
import { CARD, PAGE_TOP, PAGE_X } from "../../../lib/styles";
import { PulseHeaderSkeleton } from "../../../components/layout/RouteFallback";
import { COLUMN_CLASSES, GRID_CLASSES } from "../lib/pulseStyles";

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
 * The page's silhouette while the dashboard loads. It reads the same padding,
 * grid and column classes as the page and the route fallback, and draws the
 * route fallback's masthead, so the header and the columns land once at
 * every width.
 *
 * @param ask whether the masthead will hold the Ask form: AI is allowed.
 */
export const PulseSkeleton = ({ ask = true }: { ask?: boolean }) => {
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
      <PulseHeaderSkeleton ask={ask} />

      {/* 3-Column Grid Skeleton */}
      <div className={GRID_CLASSES}>
        {/* Column 1: Focus */}
        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.focus)}>
          <div className={cn(CARD, "p-5 flex flex-col gap-4 min-h-[400px]")}>
            <div className="flex items-center justify-between pb-3">
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
          <div className="px-2 py-2 min-h-[44px] flex items-center">
            <SkeletonLine width="w-48" className="h-4" />
          </div>
        </div>

        {/* Column 2: Intelligence */}
        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.intel)}>
          <div className={cn(CARD, "p-5 min-h-[140px] bg-primary/5")}>
            <SkeletonLine width="w-32" className="h-4 mb-3" />
            <SkeletonLine width="w-full" className="mb-2" />
            <SkeletonLine width="w-3/4" />
          </div>

          <div className={cn(CARD, "p-5 min-h-[160px] flex flex-col gap-3")}>
            <SkeletonLine width="w-20" className="h-4" />
            <SkeletonBox className="h-10 rounded-xl" />
            <SkeletonBox className="h-10 rounded-xl" />
          </div>

          <div className={cn(CARD, "p-5 min-h-[140px]")}>
            <SkeletonLine width="w-28" className="h-4 mb-3" />
            <SkeletonBox className="h-12 rounded-xl" />
          </div>

          <div className={cn(CARD, "p-5 min-h-[100px]")}>
            <SkeletonLine width="w-24" className="h-4 mb-3" />
            <SkeletonBox className="h-12 rounded-xl" />
          </div>
        </div>

        {/* Column 3: Network (Keeping up, Activity) */}
        <div className={cn("flex flex-col gap-6 p-1", COLUMN_CLASSES.network)}>
          {[1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                CARD,
                "p-5 min-h-[130px] flex flex-col justify-between",
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
