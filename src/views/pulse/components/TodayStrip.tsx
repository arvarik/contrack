import React from "react";
import { cn } from "../../../lib/utils";
import { Flame, Calendar, Clock, Cake } from "lucide-react";

export interface TodayStripProps {
  completedToday?: number;
  dueToday?: number;
  overdueCount?: number;
  birthdayCount?: number;
  streak?: number;
  onScrollToUpNext?: () => void;
  onScrollToComingUp?: () => void;
}

export const TodayStrip = ({
  completedToday = 0,
  dueToday = 0,
  overdueCount = 0,
  birthdayCount = 0,
  streak = 0,
  onScrollToUpNext,
  onScrollToComingUp,
}: TodayStripProps) => {
  const todayDateStr = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  const totalActions = completedToday + dueToday + overdueCount;
  const progressPct =
    totalActions > 0
      ? Math.round((completedToday / totalActions) * 100)
      : completedToday > 0
        ? 100
        : 0;

  // 28px SVG ring: radius = 10, circumference = 2 * PI * 10 ≈ 62.83
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * progressPct) / 100;

  return (
    <div
      aria-label="Today summary"
      className="w-full flex items-center justify-between gap-3 overflow-x-auto nice-scrollbar py-1 text-xs"
    >
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Date */}
        <div className="flex items-center gap-1.5 font-semibold text-on-surface">
          <Calendar className="w-3.5 h-3.5 text-primary opacity-80" />
          <span>{todayDateStr}</span>
        </div>

        {/* Separator */}
        <span className="w-1 h-1 rounded-full bg-outline/30 shrink-0" />

        {/* Due chip */}
        <button
          onClick={onScrollToUpNext}
          className={cn(
            "hit-area inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium transition-colors cursor-pointer text-xs",
            dueToday + overdueCount > 0
              ? overdueCount > 0
                ? "bg-error/10 text-error hover:bg-error/20"
                : "bg-primary/10 text-on-primary-wash hover:bg-primary/20"
              : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest",
          )}
        >
          <Clock className="w-3 h-3" />
          <span>
            {overdueCount > 0
              ? `${overdueCount} overdue`
              : dueToday > 0
                ? `${dueToday} due`
                : "Nothing due"}
          </span>
        </button>

        {/* Birthdays chip */}
        {birthdayCount > 0 && (
          <button
            onClick={onScrollToComingUp}
            className="hit-area inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer text-xs"
          >
            <Cake className="w-3 h-3" />
            <span>
              {birthdayCount} {birthdayCount === 1 ? "birthday" : "birthdays"}
            </span>
          </button>
        )}

        {/* Streak chip */}
        <div
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium text-xs",
            streak > 0
              ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : "bg-surface-container-high text-on-surface-variant",
          )}
          title={
            streak > 0
              ? `${streak} consecutive day streak`
              : "Log an interaction to start a streak"
          }
        >
          <Flame
            className={cn(
              "w-3.5 h-3.5",
              streak > 0 ? "text-amber-500 fill-amber-500" : "opacity-40",
            )}
          />
          <span className="tabular-nums font-bold">
            {streak} {streak === 1 ? "day" : "days"}
          </span>
        </div>
      </div>

      {/* 28px SVG Progress ring */}
      <div
        className="flex items-center gap-2 shrink-0 ml-auto pl-2"
        title={`${completedToday} of ${totalActions} completed (${progressPct}%)`}
      >
        <div className="relative w-7 h-7 flex items-center justify-center">
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            className="transform -rotate-90"
            role="img"
            aria-label={`${completedToday} of ${totalActions} follow-ups completed today`}
          >
            <circle
              cx="14"
              cy="14"
              r={radius}
              fill="none"
              className="stroke-surface-container-highest"
              strokeWidth="2.5"
            />
            <circle
              cx="14"
              cy="14"
              r={radius}
              fill="none"
              className="stroke-primary transition-all duration-500 ease-out"
              strokeWidth="2.5"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
        </div>
        <span className="text-[11px] font-semibold text-on-surface-variant tabular-nums">
          {completedToday} of {totalActions} done today
        </span>
      </div>
    </div>
  );
};
