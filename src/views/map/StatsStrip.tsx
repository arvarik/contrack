/**
 * StatsStrip — Glass strip showing live viewport aggregates. The map page
 * places it in its bottom-left corner, under the health legend.
 *
 * Renders chips for in view, at risk, overdue, average score, and time zones.
 * At risk, with a count above zero, is a button that applies its facet
 * (score:<40). The others are facts: no facet filters by them.
 * Announces changes via a debounced role="status" live region.
 * Shows an empty state with "Fit all" button when no one is in view.
 *
 * @module views/map/StatsStrip
 */
import React from "react";
import type { MapStats } from "./mapStats";
import { cn } from "../../lib/utils";
import { TONE_TEXT, TONE_WASH } from "../../lib/styles";

/**
 * A chip on the strip: `rounded-md` like every chip and pill. A count of
 * zero is quieter, in the variant ink at full strength: at 60 percent it
 * fell under AA.
 */
const CHIP = "px-2.5 py-1 rounded-md font-medium";
const CHIP_REST = "bg-surface-container/60 text-on-surface";
const CHIP_ZERO = "bg-surface-container/40 text-on-surface-variant";

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
      <div className={cn("max-w-full", className)}>
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
    <div className={cn("max-w-full overflow-x-auto", className)}>
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
        <span className={cn(CHIP, CHIP_REST)}>{stats.inView} in view</span>

        {/* At risk chip */}
        {stats.atRisk > 0 ? (
          <button
            type="button"
            onClick={() => onApplyFacet("score:<40")}
            aria-label={`${stats.atRisk} at risk, filter contacts`}
            className={cn(
              "hit-area state-layer cursor-pointer",
              CHIP,
              TONE_WASH.error,
            )}
          >
            {stats.atRisk} at risk
          </button>
        ) : (
          <span className={cn(CHIP, CHIP_ZERO)}>0 at risk</span>
        )}

        {/* Overdue chip: the overdue tone, red, as on Pulse, in the ink on
            a resting chip. No facet filters by follow-up, so it is a fact
            and not a button, and the wash would make it look like the at
            risk button beside it. */}
        {stats.overdue > 0 ? (
          <span className={cn(CHIP, CHIP_REST, TONE_TEXT.error)}>
            {stats.overdue} overdue
          </span>
        ) : (
          <span className={cn(CHIP, CHIP_ZERO)}>0 overdue</span>
        )}

        {/* Avg score chip. The number leads, like every chip in the strip. */}
        <span className={cn(CHIP, CHIP_REST)}>
          {stats.avgScore !== null ? stats.avgScore : "—"} avg score
        </span>

        {/* Time zones chip */}
        <span className={cn(CHIP, CHIP_REST)}>
          {stats.timeZones.length}{" "}
          {stats.timeZones.length === 1 ? "time zone" : "time zones"}
        </span>
      </div>
    </div>
  );
};
