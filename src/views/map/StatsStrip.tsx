/**
 * The map's bottom line: who is in view, and what to do next.
 *
 * - How many are on the map (everyone with a place), and how many are in
 *   view when some are off screen. It says "on the map" because Network
 *   counts everyone.
 * - The overdue in view, as a filter to press. Hidden at zero unless on.
 * - "Fit all" when nobody is in view, so an empty map has a way back.
 * - The heat legend, or a button back out once zoomed in past the heat.
 */
import { X } from "lucide-react";
import { LiveStatus } from "../../components/ui/LiveStatus";
import { TONE_TEXT, TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { heatGradient, type HeatStop } from "./heat";
import type { MapEmpty, MapStats } from "./mapStats";

const LINE_BUTTON =
  "hit-area state-layer inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold cursor-pointer";

const EMPTY_LINE: Record<MapEmpty, string> = {
  loading: "Loading contacts…",
  failed: "Could not load your contacts",
  none: "No one is on the map yet",
};

interface StatsStripProps {
  stats: Pick<MapStats, "inView" | "matching" | "overdue">;
  /** Why nobody is on the map, when nobody is. */
  empty?: MapEmpty;
  /** The overdue filter is on. */
  overdueOnly: boolean;
  onOverdueOnlyChange: (next: boolean) => void;
  onFitAll?: () => void;
  /** The heat's ramp while the heat layer is on, for the legend. */
  heat?: readonly HeatStop[] | null;
  /** The map is zoomed in past the heat, which has faded out. */
  heatFaded?: boolean;
  /** Zoom out to where the heat shows. */
  onZoomToHeat?: () => void;
  className?: string;
}

export const StatsStrip = ({
  stats,
  empty,
  overdueOnly,
  onOverdueOnlyChange,
  onFitAll,
  heat,
  heatFaded = false,
  onZoomToHeat,
  className,
}: StatsStripProps) => {
  const { inView, matching, overdue } = stats;
  const count = empty
    ? EMPTY_LINE[empty]
    : inView === 0
      ? "No one in view"
      : inView < matching
        ? `${inView} in view, of ${matching} on the map`
        : `${matching} on the map`;
  const announcement = overdue > 0 ? `${count}, ${overdue} overdue` : count;

  return (
    <div
      role="region"
      aria-label="In view"
      className={cn(
        "glass-panel shadow-lg rounded-2xl border border-outline-variant/20 px-2 py-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-on-surface whitespace-nowrap",
        className,
      )}
    >
      <LiveStatus label="People in view" message={announcement} />
      <span className="px-1.5 py-1 font-medium tabular-nums">{count}</span>

      {(overdue > 0 || overdueOnly) && (
        <button
          type="button"
          aria-pressed={overdueOnly}
          onClick={() => onOverdueOnlyChange(!overdueOnly)}
          title={
            overdueOnly
              ? "Show everyone again"
              : "Show only the people whose follow-up is overdue"
          }
          className={cn(
            LINE_BUTTON,
            "tabular-nums",
            overdueOnly ? TONE_WASH.error : TONE_TEXT.error,
          )}
        >
          {overdue} overdue
          {overdueOnly && <X className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      )}

      {inView === 0 && matching > 0 && onFitAll && (
        <button
          type="button"
          onClick={onFitAll}
          className={cn(LINE_BUTTON, "text-primary")}
        >
          Fit all
        </button>
      )}

      {heat &&
        (heatFaded ? (
          onZoomToHeat && (
            <button
              type="button"
              onClick={onZoomToHeat}
              className={cn(LINE_BUTTON, "text-primary")}
            >
              Zoom out for heat
            </button>
          )
        ) : (
          <span className="flex items-center gap-1.5 px-1.5 py-1 text-on-surface-variant">
            <span className="sr-only">Heat legend:</span>
            <span>Fewer</span>
            <span
              aria-hidden="true"
              className="h-2 w-14 rounded-sm"
              style={{ backgroundImage: heatGradient(heat) }}
            />
            <span>More</span>
          </span>
        ))}
    </div>
  );
};
