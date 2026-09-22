/**
 * StatsStrip — Bottom-left glass strip showing live viewport aggregates.
 *
 * Renders chips for in view, at risk, overdue, average score, and time zones.
 * Chips with a count above zero apply their facet when clicked (e.g. score:<40).
 * Announces changes via a debounced role="status" live region.
 * Shows an empty state with "Fit all" button when no one is in view.
 *
 * @module views/map/StatsStrip
 */
import React from "react";
import type { MapStats } from "./mapStats";
import { cn } from "../../lib/utils";
import { TONE_WASH } from "../../lib/styles";

export interface StatsStripProps {
  stats: MapStats;
  onApplyFacet: (facetQuery: string) => void;
  onFitAll?: () => void;
  className?: string;
}

export const StatsStrip: React.FC<StatsStripProps> = ({
  stats,
  onApplyFacet,
  onFitAll,
  className,
}) => {
  const peopleWord = stats.inView === 1 ? "person" : "people";
  const announcement = `${stats.inView} ${peopleWord} in view, ${stats.atRisk} at risk`;

  // Empty state when no contacts are in view
  if (stats.inView === 0) {
    return (
      <div
        className={cn(
          "absolute bottom-20 lg:bottom-4 left-4 z-10 max-w-[calc(100vw-2rem)]",
          className,
        )}
      >
        <div className="glass-panel shadow-lg rounded-2xl px-3 py-2 border border-outline-variant/30 flex items-center gap-2 text-xs text-on-surface-variant font-medium">
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
          <span>No one in view. Zoom out or clear filters.</span>
          {onFitAll && (
            <button
              type="button"
              onClick={onFitAll}
              className="hit-area text-primary hover:underline font-semibold cursor-pointer ml-1"
            >
              Fit all
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "absolute bottom-20 lg:bottom-4 left-4 z-10 max-w-[calc(100vw-2rem)] overflow-x-auto",
        className,
      )}
    >
      <div
        role="region"
        aria-label="Map viewport statistics"
        className="glass-panel shadow-lg rounded-2xl p-1.5 border border-outline-variant/30 flex items-center gap-1.5 text-xs text-on-surface whitespace-nowrap"
      >
        {/* Screen reader live announcement */}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {/* In view chip */}
        <span className="px-2.5 py-1 rounded-xl font-medium bg-surface-container/60 text-on-surface">
          {stats.inView} in view
        </span>

        {/* At risk chip */}
        {stats.atRisk > 0 ? (
          <button
            type="button"
            onClick={() => onApplyFacet("score:<40")}
            aria-label={`${stats.atRisk} at risk, filter contacts`}
            className={cn(
              "hit-area state-layer px-2.5 py-1 rounded-xl font-medium cursor-pointer",
              TONE_WASH.error,
            )}
          >
            {stats.atRisk} at risk
          </button>
        ) : (
          <span className="px-2.5 py-1 rounded-xl font-medium bg-surface-container/40 text-on-surface-variant/60">
            0 at risk
          </span>
        )}

        {/* Overdue chip: the overdue tone, red, as on Pulse */}
        {stats.overdue > 0 ? (
          <span
            className={cn(
              "px-2.5 py-1 rounded-xl font-medium",
              TONE_WASH.error,
            )}
          >
            {stats.overdue} overdue
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-xl font-medium bg-surface-container/40 text-on-surface-variant/60">
            0 overdue
          </span>
        )}

        {/* Avg score chip */}
        <span className="px-2.5 py-1 rounded-xl font-medium bg-surface-container/60 text-on-surface">
          avg {stats.avgScore !== null ? stats.avgScore : "—"}
        </span>

        {/* Time zones chip */}
        <span className="px-2.5 py-1 rounded-xl font-medium bg-surface-container/60 text-on-surface">
          {stats.timeZones.length}{" "}
          {stats.timeZones.length === 1 ? "time zone" : "time zones"}
        </span>
      </div>
    </div>
  );
};
