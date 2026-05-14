/**
 * AIStatsSkeleton — Loading state for the AI Stats page.
 * Shows pulsing placeholders for the summary bar, KPI cards, and feed rows.
 */
import React from "react";
import { CARD_TINTED, CARD_COMPACT, CARD } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export const AIStatsSkeleton = () => (
  <div className="space-y-4">
    {/* Summary bar skeleton */}
    <div className={cn(CARD_TINTED, "space-y-3")}>
      <div className="h-3 bg-primary/20 rounded animate-pulse w-24" />
      <div className="h-5 bg-primary/20 rounded animate-pulse w-3/4" />
      <div className="h-5 bg-primary/20 rounded animate-pulse w-full" />
    </div>

    {/* KPI row skeleton */}
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn(CARD_COMPACT, "space-y-3")}>
          <div className="flex items-start justify-between">
            <div className="h-2.5 bg-surface-container-high rounded animate-pulse w-16" />
            <div className="w-7 h-7 bg-surface-container rounded-lg animate-pulse" />
          </div>
          <div className="h-8 bg-surface-container-high rounded animate-pulse w-20 mt-2" />
        </div>
      ))}
    </div>

    {/* Feed skeleton */}
    <div className={cn(CARD, "space-y-3")}>
      <div className="h-3 bg-surface-container-high rounded animate-pulse w-20" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <div className="w-2 h-2 rounded-full bg-surface-container-high animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-surface-container-high rounded animate-pulse w-2/3" />
            <div className="h-2.5 bg-surface-container rounded animate-pulse w-1/3" />
          </div>
          <div className="h-2.5 bg-surface-container rounded animate-pulse w-16 shrink-0" />
        </div>
      ))}
    </div>
  </div>
);
