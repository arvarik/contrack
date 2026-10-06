/**
 * Twelve weekly totals as one line, drawn at the measured width: a stretched
 * SVG (`preserveAspectRatio="none"`) stretches the stroke unevenly too. Under
 * it, the last four weeks against the four before, and this week by type.
 */
import { useMemo, useState } from "react";
import { useElementWidth } from "../../../hooks/useElementWidth";
import { TONE_TEXT, type Tone } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { PULSE_TYPE } from "../lib/pulseStyles";
import type { ActivityDay } from "../../../../shared/pulse";

interface SparklineProps {
  weekTotals: number[];
  /** The 84 days of the heatmap, oldest first, today last. */
  days: ActivityDay[];
  thisWeek: {
    logged: number;
    byType: Record<string, number>;
  };
}

const HEIGHT = 40;
const PAD_Y = 4;

/** "1 note, 3 meetings", in the order the server sent the types. */
function describeWeekByType(byType: Record<string, number>): string {
  const parts = Object.entries(byType || {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => {
      const plural =
        count === 1 ? type : type.endsWith("s") ? type : `${type}s`;
      return `${count} ${plural}`;
    });
  return parts.length > 0 ? parts.join(", ") : "nothing logged yet";
}

/**
 * The last 28 days against the 28 before. Days, not weekly totals: a part
 * week against whole ones reads as a drop every Monday.
 */
function compareFourWeeks(days: ActivityDay[]): {
  recent: number;
  words: string;
  tone: "up" | "down" | "flat";
} {
  const sum = (part: ActivityDay[]) =>
    part.reduce((total, day) => total + day.count, 0);
  const recent = sum(days.slice(-28));
  const before = sum(days.slice(-56, -28));
  if (before === 0) {
    if (recent === 0)
      return { recent, words: "same as the four before", tone: "flat" };
    return { recent, words: `+${recent} on the four before`, tone: "up" };
  }
  const pct = Math.round(((recent - before) / before) * 100);
  if (pct > 0)
    return { recent, words: `+${pct}% on the four before`, tone: "up" };
  if (pct < 0)
    return { recent, words: `${pct}% on the four before`, tone: "down" };
  return { recent, words: "same as the four before", tone: "flat" };
}

/** The comparison's tone: more is good news, less is a warning. */
const TREND_TONE: Record<ReturnType<typeof compareFourWeeks>["tone"], Tone> = {
  up: "success",
  down: "warning",
  flat: "neutral",
};

export const Sparkline = ({ weekTotals, days, thisWeek }: SparklineProps) => {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  // Whole pixels: the SVG is drawn at this width and a fractional viewBox
  // would put the line half a pixel off the grid.
  const width = Math.round(useElementWidth(box) ?? 0);

  const comparison = useMemo(() => compareFourWeeks(days), [days]);

  const { pointsStr, areaStr, last } = useMemo(() => {
    if (!weekTotals || weekTotals.length === 0 || width <= 0) {
      return { pointsStr: "", areaStr: "", last: null };
    }
    // The dot at the end needs room, so the line stops short of the edge.
    const inset = 3;
    const innerWidth = Math.max(1, width - inset * 2);
    const drawHeight = HEIGHT - PAD_Y * 2;
    const maxVal = Math.max(...weekTotals, 1);
    const minVal = Math.min(...weekTotals, 0);
    const range = maxVal - minVal || 1;

    const coords: [number, number][] =
      weekTotals.length === 1
        ? [
            [
              inset,
              HEIGHT - PAD_Y - ((weekTotals[0] - minVal) / range) * drawHeight,
            ],
            [
              inset + innerWidth,
              HEIGHT - PAD_Y - ((weekTotals[0] - minVal) / range) * drawHeight,
            ],
          ]
        : weekTotals.map((val, idx) => {
            const x = inset + (idx / (weekTotals.length - 1)) * innerWidth;
            const y = HEIGHT - PAD_Y - ((val - minVal) / range) * drawHeight;
            return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
          });

    const pts = coords.map(([x, y]) => `${x},${y}`).join(" ");
    const area = `${pts} ${coords[coords.length - 1][0]},${HEIGHT} ${coords[0][0]},${HEIGHT}`;
    return { pointsStr: pts, areaStr: area, last: coords[coords.length - 1] };
  }, [weekTotals, width]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={setBox} className="w-full h-10" aria-hidden="true">
        {width > 0 && (
          <svg
            data-sparkline=""
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="block overflow-visible"
          >
            <defs>
              <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-primary)"
                  stopOpacity="0.22"
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-primary)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            {areaStr && (
              <polygon points={areaStr} fill="url(#sparkline-grad)" />
            )}
            {pointsStr && (
              <polyline
                points={pointsStr}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {last && (
              <circle
                cx={last[0]}
                cy={last[1]}
                r={3}
                fill="var(--color-primary)"
              />
            )}
          </svg>
        )}
      </div>

      <p className={cn(PULSE_TYPE.meta, "tabular-nums")}>
        <span className="font-semibold text-on-surface">
          {comparison.recent}
        </span>{" "}
        in the last four weeks ·{" "}
        {/* One phrase, so a narrow card wraps it whole. */}
        <span
          className={cn(
            "font-semibold whitespace-nowrap",
            TONE_TEXT[TREND_TONE[comparison.tone]],
          )}
        >
          {comparison.words}
        </span>
      </p>
      <p className={PULSE_TYPE.meta}>
        This week: {describeWeekByType(thisWeek?.byType ?? {})}
      </p>
    </div>
  );
};
