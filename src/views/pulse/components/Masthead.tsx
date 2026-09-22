/**
 * Masthead: the top of the morning page.
 *
 * The page should answer "what day is it and how am I doing" before
 * anything else, so the day is the headline. The `h1` stays "Pulse", because
 * six specs and the landmark structure need it, and it becomes a 13 px page
 * label over a 32 px date in the headline face. One sentence replaces the
 * old row of chips: "2 overdue, 2 due today, 3 birthdays this week. 12 days
 * in a row." From `sm` up each count is a button that jumps to its card.
 * Below `sm` the counts are plain text, because the queue starts one flick
 * down and inline 44 px tap boxes would overlap across two wrapped lines.
 * The sentence is text, so it wraps and nothing scrolls sideways.
 *
 * Log a note is the one primary action. New contact and Customize layout
 * sit in a "More" menu: customize is a once-a-year action and does not
 * belong beside the page's main verb. The `c` key still toggles it.
 *
 * `children` renders under the sentence. Prompt 3 puts the Ask form there.
 * `quiet` is the welcome state: the sentence and the progress mark are left
 * out, and the date, the label and the actions stay.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { Ellipsis, PenLine, SlidersHorizontal, UserPlus } from "lucide-react";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { NAMES } from "../../../lib/names";
import { openQuickNote } from "../../../lib/appEvents";
import { cn } from "../../../lib/utils";
import { PULSE_TYPE } from "../lib/pulseStyles";
import {
  buildDayLine,
  describeProgress,
  type JumpTarget,
  type MastheadCounts,
} from "../lib/dayLine";

export type { JumpTarget, MastheadCounts };

export interface MastheadProps {
  counts: MastheadCounts;
  isEditing: boolean;
  onToggleCustomize: () => void;
  onJumpTo: (target: JumpTarget) => void;
  /** Rendered under the sentence. Prompt 3 puts the Ask form here. */
  children?: React.ReactNode;
  /** The welcome state: the sentence and the progress mark are left out. */
  quiet?: boolean;
}

/** The Tailwind `sm` breakpoint, where the counts become buttons. */
const SM_QUERY = "(min-width: 640px)";

/** The ring's geometry: 40 px, radius 16, stroke 3. */
const RING_RADIUS = 16;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * A 40 px ring beside the words that describe the day's follow-ups. One
 * `role="img"` named by the words, so a screen reader hears them once.
 */
export const ProgressMark = ({
  completed,
  toDo,
}: {
  completed: number;
  toDo: number;
}) => {
  const words = describeProgress(completed, toDo);
  const total = completed + toDo;
  const fraction = total > 0 ? completed / total : 0;
  const offset = RING_CIRCUMFERENCE * (1 - fraction);

  return (
    <div role="img" aria-label={words} className="flex items-center gap-2">
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        className="-rotate-90 shrink-0"
        aria-hidden="true"
      >
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          className="stroke-surface-container-highest"
          strokeWidth="3"
        />
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          className="stroke-primary transition-all duration-500 ease-out"
          strokeWidth="3"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className={cn(PULSE_TYPE.meta, "font-semibold tabular-nums")}>
        {words}
      </span>
    </div>
  );
};

export const Masthead = ({
  counts,
  isEditing,
  onToggleCustomize,
  onJumpTo,
  children,
  quiet = false,
}: MastheadProps) => {
  const navigate = useNavigate();
  const wide = useMediaQuery(SM_QUERY);

  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const parts = buildDayLine(counts);

  return (
    <header aria-label="Today summary" className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className={cn(PULSE_TYPE.label, "leading-tight")}>
            {NAMES.pulse.label}
          </h1>
          <p className={PULSE_TYPE.date}>{date}</p>
          {!quiet && (
            <p className={cn(PULSE_TYPE.line, "mt-1")}>
              {parts.map((part, index) =>
                part.target && wide ? (
                  <button
                    key={index}
                    type="button"
                    onClick={() => onJumpTo(part.target!)}
                    className="hit-area underline decoration-outline-variant underline-offset-4 hover:decoration-primary hover:text-on-surface transition-colors"
                  >
                    {part.text}
                  </button>
                ) : (
                  <React.Fragment key={index}>{part.text}</React.Fragment>
                ),
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
          {!quiet && (
            <ProgressMark
              completed={counts.completedToday}
              toDo={counts.overdue + counts.dueToday}
            />
          )}
          <button
            type="button"
            onClick={() => openQuickNote()}
            className="btn-primary"
          >
            <PenLine className="w-4 h-4" aria-hidden="true" />
            Log a note
          </button>
          <ActionMenu
            label="More"
            icon={Ellipsis}
            items={[
              {
                id: "new-contact",
                label: "New contact",
                icon: UserPlus,
                onSelect: () => navigate("/?new=1"),
              },
              {
                id: "customize",
                label: isEditing ? "Done editing layout" : "Customize layout",
                icon: SlidersHorizontal,
                onSelect: onToggleCustomize,
              },
            ]}
          />
        </div>
      </div>
      {children}
    </header>
  );
};
