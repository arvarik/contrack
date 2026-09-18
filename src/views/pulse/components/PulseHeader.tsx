import React from "react";
import { useNavigate } from "react-router-dom";
import { PenLine, UserPlus, SlidersHorizontal } from "lucide-react";
import { PAGE_TITLE } from "../../../lib/styles";
import { NAMES } from "../../../lib/names";
import { openQuickNote } from "../../../lib/appEvents";
import { TodayStrip } from "./TodayStrip";

export interface PulseHeaderProps {
  completedToday?: number;
  dueToday?: number;
  overdueCount?: number;
  birthdayCount?: number;
  streak?: number;
  onScrollToUpNext?: () => void;
  onScrollToComingUp?: () => void;
}

export const PulseHeader = ({
  completedToday = 0,
  dueToday = 0,
  overdueCount = 0,
  birthdayCount = 0,
  streak = 0,
  onScrollToUpNext,
  onScrollToComingUp,
}: PulseHeaderProps) => {
  const navigate = useNavigate();

  const handleNewContact = () => {
    navigate("/?new=1");
  };

  const handleLogNote = () => {
    openQuickNote();
  };

  return (
    <header className="flex flex-col gap-3 pb-2 border-b border-outline/10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Title */}
        <h1 className={PAGE_TITLE}>{NAMES.pulse.label}</h1>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleLogNote}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-on-primary text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
          >
            <PenLine className="w-4 h-4" />
            <span>Log a note</span>
          </button>

          <button
            onClick={handleNewContact}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs sm:text-sm font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>New contact</span>
          </button>

          <button
            disabled
            title="Coming soon"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container text-on-surface-variant text-xs sm:text-sm font-medium opacity-50 cursor-not-allowed"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Customize</span>
          </button>
        </div>
      </div>

      {/* Today status strip */}
      <TodayStrip
        completedToday={completedToday}
        dueToday={dueToday}
        overdueCount={overdueCount}
        birthdayCount={birthdayCount}
        streak={streak}
        onScrollToUpNext={onScrollToUpNext}
        onScrollToComingUp={onScrollToComingUp}
      />
    </header>
  );
};
