/**
 * Heatmap: twelve weeks of days, one square each, filling the card.
 *
 * The squares are an SVG that scales to the card's width, so the same
 * twelve columns fill a 350 px phone card and a 430 px desktop column. The
 * month labels above and the weekday letters at the left are HTML, not SVG
 * text: text inside a scaled SVG scales with it, and at a desktop width
 * eleven SVG units render at twenty-two pixels, which is bigger than the
 * card's title. HTML labels stay 12 px at every width. The letters sit in a
 * seven-row grid the same height as the SVG, so each letter is centred on
 * its row.
 *
 * A pointer over a square, or a tap on it, shows one tooltip with the day's
 * words: "Wed, Sep 17: 2 notes, 1 call". A second tap on the same square,
 * or a tap anywhere else, hides it. The squares are not tab stops. The same
 * words sit in a visually hidden list for a screen reader, along with the
 * twelve weekly totals.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { heatmapScale, getHeatmapAlpha } from "../lib/heatmapScale";
import type { ActivityDay } from "../../../../shared/pulse";
import { weekStartsOn, type WeekStartPref } from "../../../../shared/dates";
import { toLocalDay } from "../../../../shared/pulse";

export interface HeatmapProps {
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

/** The tooltip's half width, so it never leaves the card. */
const TOOLTIP_HALF = 90;

/** "Wed, Sep 17" in the person's own locale. */
export function formatCellDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** The words for one day: the date, then the count by type. */
export function formatCellTitle(
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
}

interface ActiveCell {
  dayStr: string;
  words: string;
  /** The square's centre and top, in px from the wrapper's top left. */
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
  const [active, setActive] = useState<ActiveCell | null>(null);

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

  // Twelve columns of seven days, the current week last, each column
  // starting on the day the account's week starts.
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
        });
      }
      columns.push(colDays);
    }

    // A month label over the first column and over each column whose first
    // day is in a new month. Two labels one column apart would overlap, so
    // the later one wins.
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

    // M, W and F, whichever rows they fall on for this week start, in the
    // person's own language.
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

  const wrapperWidth = wrapperRef.current?.getBoundingClientRect().width ?? 0;
  const tooltipLeft = active
    ? wrapperWidth > TOOLTIP_HALF * 2
      ? Math.min(Math.max(active.x, TOOLTIP_HALF), wrapperWidth - TOOLTIP_HALF)
      : active.x
    : 0;

  const daysWithWords = useMemo(
    () =>
      grid
        .flat()
        .filter((cell) => cell.count > 0)
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
      <div className="overflow-x-auto nice-scrollbar">
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

      {/* The words for a screen reader: the weeks, then the days with anything logged. */}
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
          data-heatmap-tooltip=""
          aria-hidden="true"
          className="menu-panel absolute z-20 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{ left: tooltipLeft, top: active.y - 6 }}
        >
          {active.words}
        </div>
      )}
    </div>
  );
};
