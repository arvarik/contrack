import { useMemo } from "react";
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

function formatCellDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatCellTitle(
  date: Date,
  count: number,
  byType: Record<string, number>,
): string {
  const dateStr = formatCellDate(date);
  if (count <= 0) {
    return `${dateStr}: No interactions`;
  }

  const typeEntries = Object.entries(byType).filter(([_, c]) => c > 0);
  if (typeEntries.length === 0) {
    return `${dateStr}: ${count} ${count === 1 ? "interaction" : "interactions"}`;
  }

  const parts = typeEntries.map(([type, cnt]) => {
    const plural = cnt === 1 ? type : type.endsWith("s") ? type : `${type}s`;
    return `${cnt} ${plural}`;
  });

  return `${dateStr}: ${parts.join(", ")}`;
}

export const Heatmap = ({
  days,
  weekTotals,
  thisWeekLogged = 0,
  weekStartPref = "monday",
}: HeatmapProps) => {
  const total12Weeks = useMemo(() => {
    return weekTotals.reduce((sum, w) => sum + w, 0);
  }, [weekTotals]);

  const ariaLabel = `Interactions in the last 12 weeks: ${total12Weeks} total, ${thisWeekLogged} this week`;

  const dayMap = useMemo(() => {
    const map = new Map<string, ActivityDay>();
    for (const d of days) {
      map.set(d.day, d);
    }
    return map;
  }, [days]);

  const scaleFn = useMemo(() => {
    const counts = days.map((d) => d.count);
    return heatmapScale(counts);
  }, [days]);

  // Compute 12 columns of 7 days starting from weekStartsOn
  const { grid } = useMemo(() => {
    const now = new Date();
    const todayLocal = toLocalDay(now);
    const startDay = weekStartsOn(weekStartPref); // 0 = Sun, 1 = Mon
    const currentDay = now.getDay();
    const diff = (currentDay - startDay + 7) % 7;

    const currentWeekStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - diff,
    );
    const gridStart = new Date(
      currentWeekStart.getFullYear(),
      currentWeekStart.getMonth(),
      currentWeekStart.getDate() - 11 * 7,
    );

    const columns: Array<
      Array<{
        date: Date;
        dayStr: string;
        count: number;
        byType: Record<string, number>;
        isToday: boolean;
      }>
    > = [];

    for (let col = 0; col < 12; col++) {
      const colDays = [];
      for (let row = 0; row < 7; row++) {
        const cellDate = new Date(
          gridStart.getFullYear(),
          gridStart.getMonth(),
          gridStart.getDate() + col * 7 + row,
        );
        const cellDayStr = toLocalDay(cellDate);
        const data = dayMap.get(cellDayStr);
        colDays.push({
          date: cellDate,
          dayStr: cellDayStr,
          count: data?.count ?? 0,
          byType: data?.byType ?? {},
          isToday: cellDayStr === todayLocal,
        });
      }
      columns.push(colDays);
    }

    return { grid: columns };
  }, [dayMap, weekStartPref]);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="overflow-x-auto nice-scrollbar py-1">
        <svg
          role="img"
          aria-label={ariaLabel}
          className="w-auto h-[108px] block min-w-[185px]"
          viewBox="-2 -2 182 108"
        >
          {grid.map((col, colIdx) =>
            col.map((cell, rowIdx) => {
              const x = colIdx * 15;
              const y = rowIdx * 15;
              const step = scaleFn(cell.count);
              const alpha = getHeatmapAlpha(step);

              return (
                <rect
                  key={`${colIdx}-${rowIdx}`}
                  x={x}
                  y={y}
                  width={12}
                  height={12}
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
                  className="transition-colors duration-150"
                >
                  <title>
                    {formatCellTitle(cell.date, cell.count, cell.byType)}
                  </title>
                </rect>
              );
            }),
          )}
        </svg>

        {/* Visually hidden list of weekly totals for screen readers */}
        <ul className="sr-only">
          {weekTotals.map((tot, idx) => (
            <li key={idx}>
              Week {idx + 1}: {tot} interactions
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
