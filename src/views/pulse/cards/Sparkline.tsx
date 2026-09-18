import React, { useMemo } from "react";
import {
  Flame,
  Phone,
  Calendar,
  Mail,
  FileText,
  ActivitySquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../../lib/utils";

const TYPE_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  meeting: Calendar,
  email: Mail,
  note: FileText,
  default: ActivitySquare,
};

export interface SparklineProps {
  weekTotals: number[];
  streak: {
    current: number;
    best: number;
  };
  thisWeek: {
    logged: number;
    byType: Record<string, number>;
  };
}

export const Sparkline = ({ weekTotals, streak, thisWeek }: SparklineProps) => {
  // Month comparison: Last 4 weeks vs previous 4 weeks
  const { thisMonthTotal, comparisonText, toneClass } = useMemo(() => {
    const thisMonth = weekTotals.slice(-4).reduce((sum, w) => sum + w, 0);
    const lastMonth = weekTotals.slice(-8, -4).reduce((sum, w) => sum + w, 0);

    if (lastMonth === 0) {
      if (thisMonth === 0) {
        return {
          thisMonthTotal: 0,
          comparisonText: "0% vs last month",
          toneClass: "text-on-surface-variant",
        };
      }
      return {
        thisMonthTotal: thisMonth,
        comparisonText: `+${thisMonth} vs last month`,
        toneClass: "text-success",
      };
    }

    const diffPct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
    if (diffPct > 0) {
      return {
        thisMonthTotal: thisMonth,
        comparisonText: `+${diffPct}% vs last month`,
        toneClass: "text-success",
      };
    }
    if (diffPct < 0) {
      return {
        thisMonthTotal: thisMonth,
        comparisonText: `${diffPct}% vs last month`,
        toneClass: "text-warning",
      };
    }
    return {
      thisMonthTotal: thisMonth,
      comparisonText: "0% vs last month",
      toneClass: "text-on-surface-variant",
    };
  }, [weekTotals]);

  // 40 px tall SVG polyline
  const { pointsStr, areaStr } = useMemo(() => {
    if (!weekTotals || weekTotals.length === 0) {
      return { pointsStr: "", areaStr: "" };
    }

    const width = 220;
    const height = 40;
    const paddingY = 4;
    const effectiveHeight = height - paddingY * 2;

    const maxVal = Math.max(...weekTotals, 1);
    const minVal = Math.min(...weekTotals, 0);
    const range = maxVal - minVal || 1;

    const coords: [number, number][] = weekTotals.map((val, idx) => {
      const x = (idx / (weekTotals.length - 1)) * width;
      const y = height - paddingY - ((val - minVal) / range) * effectiveHeight;
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });

    const pts = coords.map(([x, y]) => `${x},${y}`).join(" ");
    const area = `${pts} ${width},${height} 0,${height}`;

    return { pointsStr: pts, areaStr: area };
  }, [weekTotals]);

  const activeTypeEntries = useMemo(() => {
    return Object.entries(thisWeek.byType || {}).filter(
      ([_, count]) => count > 0,
    );
  }, [thisWeek.byType]);

  return (
    <div className="flex flex-col gap-3 pt-2 border-t border-outline/10">
      {/* Polyline chart (40px tall) */}
      <div className="w-full h-10 relative overflow-hidden">
        <svg
          viewBox="0 0 220 40"
          className="w-full h-10 overflow-visible"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-primary)"
                stopOpacity="0.25"
              />
              <stop
                offset="100%"
                stopColor="var(--color-primary)"
                stopOpacity="0.0"
              />
            </linearGradient>
          </defs>
          {areaStr && <polygon points={areaStr} fill="url(#sparkline-grad)" />}
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
        </svg>
      </div>

      {/* Month comparison */}
      <div className="text-xs text-on-surface-variant font-medium flex items-center justify-between">
        <span>
          <strong className="text-on-surface font-semibold">
            {thisMonthTotal}
          </strong>{" "}
          this month ·{" "}
          <span className={cn("font-semibold", toneClass)}>
            {comparisonText}
          </span>
        </span>

        {/* Streak with required tooltip */}
        <div
          title="Days you logged something"
          className="cursor-help inline-flex items-center gap-1 text-xs text-on-surface font-semibold"
        >
          <Flame className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            {streak.current} {streak.current === 1 ? "day" : "days"} · best{" "}
            {streak.best}
          </span>
        </div>
      </div>

      {/* This week counts by type as small pills */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {activeTypeEntries.length > 0 ? (
          activeTypeEntries.map(([type, count]) => {
            const Icon = TYPE_ICONS[type.toLowerCase()] || TYPE_ICONS.default;
            const pluralLabel =
              count === 1 ? type : type.endsWith("s") ? type : `${type}s`;
            return (
              <span
                key={type}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-container text-on-surface-variant"
              >
                <Icon className="w-3 h-3 text-primary opacity-85" />
                <span>
                  {count} {pluralLabel}
                </span>
              </span>
            );
          })
        ) : (
          <span className="text-[11px] text-on-surface-variant">
            0 logged this week
          </span>
        )}
      </div>
    </div>
  );
};
