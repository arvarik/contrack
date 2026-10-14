/**
 * Twelve weeks of days, one square each, in an SVG that scales to the card.
 * The month and weekday labels are HTML: SVG text scales with the SVG and
 * grew larger than the card's title. A pointer or a tap shows the day in a
 * tooltip. The squares are not tab stops, so a hidden list carries the same
 * words and the weekly totals for a screen reader.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { heatmapScale, getHeatmapAlpha } from "../lib/heatmapScale";
import type { ActivityDay } from "../../../../shared/pulse";
import { weekStartsOn, type WeekStartPref } from "../../../../shared/dates";
import { toLocalDay } from "../../../../shared/pulse";

interface HeatmapProps {
  days: ActivityDay[];
  weekTotals: number[];
  thisWeekLogged?: number;
  weekStartPref?: WeekStartPref;
}

/** The grid: twelve columns of seven, a 15-unit step, 12-unit squares. */
const COLS = 12;
const ROWS = 7;
const STEP = 15;
const CELL = 12;
const PAD = (STEP - CELL) / 2;
const VIEW_W = COLS * STEP;
const VIEW_H = ROWS * STEP;

/** Minimum tooltip half-width clamp, expanded dynamically for longer text. */
const TOOLTIP_HALF = 90;
const TOOLTIP_MARGIN = 4;

/**
 * Clamps the tooltip's center x so a wide multi-type summary never clips
 * against the parent CardFrame's `overflow-hidden` edge on narrow viewports.
 */
export function clampTooltipX(
  x: number,
  wrapperWidth: number,
  words: string,
  measuredWidth = 0,
): number {
  if (wrapperWidth <= 0) return x;
  const estimatedWidth = Math.max(
    TOOLTIP_HALF * 2,
    Math.ceil(words.length * 6.8 + 22),
  );
  const width = Math.min(
    Math.max(0, wrapperWidth - TOOLTIP_MARGIN * 2),
    measuredWidth > 0 ? measuredWidth : estimatedWidth,
  );
  const half = width / 2 + TOOLTIP_MARGIN;
  if (wrapperWidth <= half * 2) return wrapperWidth / 2;
  return Math.min(Math.max(x, half), wrapperWidth - half);
}

/** "Wed, Sep 17" in the person's own locale. */
function formatCellDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** The words for one day: the date, then the count by type. */
function formatCellTitle(
  date: Date,
  count: number,
  byType: Record<string, number>,
): string {
  const dateStr = formatCellDate(date);
  if (count <= 0) return `${dateStr}: No interactions`;

  const typeEntries = Object.entries(byType).filter(([, c]) => c > 0);
  if (typeEntries.length === 0) {
    return `${dateStr}: ${count} ${count === 1 ? "interaction" : "interactions"}`;
  }

  const parts = typeEntries.map(([type, cnt]) => {
    const plural = cnt === 1 ? type : type.endsWith("s") ? type : `${type}s`;
    return `${cnt} ${plural}`;
  });
  return `${dateStr}: ${parts.join(", ")}`;
}

interface Cell {
  date: Date;
  dayStr: string;
  count: number;
  byType: Record<string, number>;
  isToday: boolean;
  isFuture: boolean;
}

interface ActiveCell {
  dayStr: string;
  words: string;
  /** The square's center and top, in px from the wrapper's top left. */
  x: number;
  y: number;
}

export const Heatmap = ({
  days,
  weekTotals,
  thisWeekLogged = 0,
  weekStartPref = "monday",
}: HeatmapProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [tooltipWidth, setTooltipWidth] = useState(0);

  const total12Weeks = useMemo(
    () => weekTotals.reduce((sum, w) => sum + w, 0),
    [weekTotals],
  );
  const ariaLabel = `Interactions in the last 12 weeks: ${total12Weeks} total, ${thisWeekLogged} this week`;

  const dayMap = useMemo(() => {
    const map = new Map<string, ActivityDay>();
    for (const d of days) map.set(d.day, d);
    return map;
  }, [days]);

  const scaleFn = useMemo(() => heatmapScale(days.map((d) => d.count)), [days]);

  // Twelve columns of seven days, the current week last.
  const { grid, monthLabels, weekdayLetters } = useMemo(() => {
    const now = new Date();
    const todayLocal = toLocalDay(now);
    const startDay = weekStartsOn(weekStartPref);
    const diff = (now.getDay() - startDay + 7) % 7;
    const currentWeekStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - diff,
    );
    const gridStart = new Date(
      currentWeekStart.getFullYear(),
      currentWeekStart.getMonth(),
      currentWeekStart.getDate() - (COLS - 1) * 7,
    );

    const columns: Cell[][] = [];
    for (let col = 0; col < COLS; col++) {
      const colDays: Cell[] = [];
      for (let row = 0; row < ROWS; row++) {
        const cellDate = new Date(
          gridStart.getFullYear(),
          gridStart.getMonth(),
          gridStart.getDate() + col * 7 + row,
        );
        const dayStr = toLocalDay(cellDate);
        const data = dayMap.get(dayStr);
        colDays.push({
          date: cellDate,
          dayStr,
          count: data?.count ?? 0,
          byType: data?.byType ?? {},
          isToday: dayStr === todayLocal,
          isFuture: dayStr > todayLocal,
        });
      }
      columns.push(colDays);
    }

    // A label over each column that starts a month. Of two labels one column
    // apart, which would overlap, the later one wins.
    const candidates: { col: number; text: string }[] = [];
    for (let col = 0; col < COLS; col++) {
      const month = columns[col][0].date.getMonth();
      const prev = col > 0 ? columns[col - 1][0].date.getMonth() : -1;
      if (col === 0 || month !== prev) {
        candidates.push({
          col,
          text: columns[col][0].date.toLocaleDateString(undefined, {
            month: "short",
          }),
        });
      }
    }
    const labels = candidates.filter(
      (label, index) =>
        index === candidates.length - 1 ||
        candidates[index + 1].col - label.col >= 2,
    );

    // M, W and F, in the person's own language.
    const letters = columns[0].map((cell) => {
      const weekday = cell.date.getDay();
      return weekday === 1 || weekday === 3 || weekday === 5
        ? cell.date.toLocaleDateString(undefined, { weekday: "narrow" })
        : "";
    });

    return { grid: columns, monthLabels: labels, weekdayLetters: letters };
  }, [dayMap, weekStartPref]);

  // A tap anywhere outside the squares hides the tooltip.
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-heatmap-cell]")) setActive(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active]);

  const show = (cell: Cell, target: Element) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const own = target.getBoundingClientRect();
    const box = wrapper.getBoundingClientRect();
    setActive({
      dayStr: cell.dayStr,
      words: formatCellTitle(cell.date, cell.count, cell.byType),
      x: own.left - box.left + own.width / 2,
      y: own.top - box.top,
    });
  };

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) {
      setTooltipWidth(0);
      return;
    }
    const w = tooltipRef.current.getBoundingClientRect().width;
    setTooltipWidth(w);
  }, [active]);

  const wrapperWidth = wrapperRef.current?.getBoundingClientRect().width ?? 0;
  const tooltipLeft = active
    ? clampTooltipX(active.x, wrapperWidth, active.words, tooltipWidth)
    : 0;

  const daysWithWords = useMemo(
    () =>
      grid
        .flat()
        .filter((cell) => !cell.isFuture && cell.count > 0)
        .map((cell) => ({
          key: cell.dayStr,
          words: formatCellTitle(cell.date, cell.count, cell.byType),
        })),
    [grid],
  );

  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1.5 w-full">
      {/* The wrapper keeps its class for the phone test. The SVG scales, so
          it never scrolls. */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[auto_1fr] grid-rows-[auto_1fr] gap-x-1.5 gap-y-1">
          <div aria-hidden="true" />
          <div
            aria-hidden="true"
            data-heatmap-months=""
            className="relative h-4 text-xs leading-4 text-on-surface-variant"
          >
            {monthLabels.map((label) => (
              <span
                key={label.col}
                className="absolute top-0"
                style={{ left: `${(label.col / COLS) * 100}%` }}
              >
                {label.text}
              </span>
            ))}
          </div>
          <div
            aria-hidden="true"
            data-heatmap-weekdays=""
            className="grid grid-rows-7 w-3 text-xs leading-none text-on-surface-variant"
          >
            {weekdayLetters.map((letter, row) => (
              <span key={row} className="flex items-center">
                {letter}
              </span>
            ))}
          </div>
          <svg
            role="img"
            aria-label={ariaLabel}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            width="100%"
            preserveAspectRatio="xMinYMin meet"
            className="block w-full h-auto"
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") setActive(null);
            }}
          >
            {grid.map((col, colIdx) =>
              col.map((cell, rowIdx) => {
                if (cell.isFuture) {
                  return (
                    <rect
                      key={cell.dayStr}
                      data-heatmap-future={cell.dayStr}
                      x={colIdx * STEP + PAD}
                      y={rowIdx * STEP + PAD}
                      width={CELL}
                      height={CELL}
                      rx={2}
                      className="opacity-0 pointer-events-none"
                    />
                  );
                }
                const step = scaleFn(cell.count);
                const alpha = getHeatmapAlpha(step);
                return (
                  <rect
                    key={cell.dayStr}
                    data-heatmap-cell={cell.dayStr}
                    x={colIdx * STEP + PAD}
                    y={rowIdx * STEP + PAD}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={
                      cell.count === 0
                        ? "var(--color-surface-container-high)"
                        : "var(--color-primary)"
                    }
                    fillOpacity={cell.count === 0 ? 0.6 : alpha}
                    stroke="var(--color-primary)"
                    strokeWidth={cell.isToday ? 2 : 0.75}
                    strokeOpacity={
                      cell.isToday
                        ? 1
                        : cell.count > 0
                          ? Math.max(alpha * 0.8, 0.3)
                          : 0.15
                    }
                    className="transition-colors"
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "touch") {
                        show(cell, event.currentTarget);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (event.pointerType !== "touch") return;
                      if (active?.dayStr === cell.dayStr) setActive(null);
                      else show(cell, event.currentTarget);
                    }}
                  />
                );
              }),
            )}
          </svg>
        </div>
      </div>

      {/* The same words for a screen reader. */}
      <ul className="sr-only">
        {weekTotals.map((tot, idx) => (
          <li key={idx}>
            Week {idx + 1}: {tot} interactions
          </li>
        ))}
      </ul>
      {daysWithWords.length > 0 && (
        <ul className="sr-only">
          {daysWithWords.map((day) => (
            <li key={day.key}>{day.words}</li>
          ))}
        </ul>
      )}

      {active && (
        <div
          ref={tooltipRef}
          data-heatmap-tooltip=""
          aria-hidden="true"
          className="menu-panel absolute z-20 max-w-[calc(100%-0.5rem)] truncate px-2.5 py-1.5 text-xs font-medium whitespace-nowrap pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{ left: tooltipLeft, top: active.y - 6 }}
        >
          {active.words}
        </div>
      )}
    </div>
  );
};
