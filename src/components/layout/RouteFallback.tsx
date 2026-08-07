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
 *
 * These are deliberately dependency-free: they are imported eagerly by App, so
 * anything they touch is pulled into the entry bundle. Approximating a shape
 * in a few divs is worth more than sharing code with the lazy chunk.
 */
import React from "react";
import { cn } from "../../lib/utils";
import { CARD, PAGE_TITLE, SECTION_BG } from "../../lib/styles";

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

/** Page chrome shared by the full-page routes, so the header never jumps. */
const PageHeader = ({ width }: { width: string }) => (
  <header className={cn(SECTION_BG, "px-4 sm:px-6 py-5 sm:py-6 shrink-0")}>
    <div className={cn(PAGE_TITLE, "flex items-center gap-3")}>
      <div className="w-10 h-10 rounded-xl bg-primary/10 animate-pulse shrink-0" />
      <Bar className={cn("h-6", width)} />
    </div>
  </header>
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
    // Mirrors DashboardSkeleton: KPI row, insight bar, then swimlanes.
    return (
      <div className="w-full h-full overflow-hidden bg-surface">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-10 flex flex-col gap-6 sm:gap-8">
          <Bar className="h-8 w-32" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            <Block className="h-24 sm:h-32" />
            <Block className="h-24 sm:h-32" />
            <Block className="h-24 sm:h-32" />
          </div>
          <Block className="h-[120px] bg-primary/5" />
          <div className="flex flex-col gap-3">
            <Bar className="h-4 w-24" />
            <Block className="h-[76px]" />
            <Block className="h-[76px]" />
          </div>
        </div>
      </div>
    );
  }

  if (variant === "search") {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-surface">
        <PageHeader width="w-44" />
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

  // settings
  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface">
      <PageHeader width="w-36" />
      <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto w-full space-y-8">
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
  );
};
