import React from "react";
import { cn } from "../../../lib/utils";
import { CARD } from "../../../lib/styles";

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

export const PulseSkeleton = () => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading Pulse"
      className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 md:p-10 flex flex-col gap-6 pb-32"
    >
      {/* Header skeleton */}
      <div className="flex flex-col gap-3 pb-2 border-b border-outline/10">
        <div className="flex items-center justify-between gap-4">
          <SkeletonLine width="w-32" className="h-8" />
          <div className="flex items-center gap-2">
            <SkeletonBox className="w-24 h-8 rounded-xl" />
            <SkeletonBox className="w-28 h-8 rounded-xl" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SkeletonLine width="w-28" className="h-5" />
          <SkeletonBox className="w-16 h-5 rounded-full" />
          <SkeletonBox className="w-20 h-5 rounded-full" />
        </div>
      </div>

      {/* 3-Column Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: Focus */}
        <div className="order-1 lg:col-span-5 2xl:col-span-4 flex flex-col gap-6">
          <div className={cn(CARD, "p-5 flex flex-col gap-4 min-h-[400px]")}>
            <div className="flex items-center justify-between pb-3 border-b border-outline/10">
              <SkeletonLine width="w-24" className="h-5" />
              <SkeletonBox className="w-8 h-4 rounded-full" />
            </div>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="p-3.5 rounded-xl border border-outline/10 bg-surface-container-lowest flex items-center gap-3"
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

          <div className={cn(CARD, "p-4 min-h-[60px]")}>
            <SkeletonLine width="w-32" className="h-4" />
          </div>
        </div>

        {/* Column 2: Intelligence */}
        <div className="order-3 lg:col-span-12 2xl:order-2 2xl:col-span-4 flex flex-col gap-6">
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

        {/* Column 3: Network */}
        <div className="order-2 lg:col-span-7 2xl:order-3 2xl:col-span-4 flex flex-col gap-6">
          {[1, 2, 3].map((i) => (
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
