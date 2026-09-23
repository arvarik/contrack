/**
 * Masthead: the top of the morning page.
 *
 * The page should answer "what day is it and how am I doing" before
 * anything else. It is the shared `PageHeader`: the title is "Pulse", the
 * page's `h1` at the size every page's title has, and the day continues the
 * line in the variant ink, so the date still leads without taking the
 * page's name. One line of facts replaces the old row of chips: "2 overdue ·
 * 2 due today · 3 birthdays this week · 12 days in a row". The items are
 * joined by the middle dot (`MetaDot`), with no commas and no closing
 * period, and one item stands alone with no dot. From `sm` up each count is
 * a button that jumps to its card. Below `sm` the counts are plain text,
 * because the queue starts one flick down and inline 44 px tap boxes would
 * overlap across two wrapped lines. The line is text, so it wraps and
 * nothing scrolls sideways.
 *
 * Log note is the one primary action. New contact and Customize layout sit
 * in a "More" menu: customize is a once-a-year action and does not belong
 * beside the page's main verb. The `c` key still toggles it. A progress ring
 * with "3 to do" used to sit beside Log note. It repeated the line's
 * counts in a smaller, vaguer form, and it is gone.
 *
 * `quiet` is the welcome state: the line is left out, and the title, the day
 * and the actions stay.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { Ellipsis, PenLine, SlidersHorizontal, UserPlus } from "lucide-react";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { MetaDot } from "../../../components/ui/MetaDot";
import { PageHeader } from "../../../components/layout/PageHeader";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { NAMES } from "../../../lib/names";
import { openQuickNote } from "../../../lib/appEvents";
import {
  buildDayLine,
  type JumpTarget,
  type MastheadCounts,
} from "../lib/dayLine";

export type { JumpTarget, MastheadCounts };

export interface MastheadProps {
  counts: MastheadCounts;
  isEditing: boolean;
  onToggleCustomize: () => void;
  onJumpTo: (target: JumpTarget) => void;
  /** The welcome state: the line is left out. */
  quiet?: boolean;
}

/** The Tailwind `sm` breakpoint, where the counts become buttons. */
const SM_QUERY = "(min-width: 640px)";

export const Masthead = ({
  counts,
  isEditing,
  onToggleCustomize,
  onJumpTo,
  quiet = false,
}: MastheadProps) => {
  const navigate = useNavigate();
  const wide = useMediaQuery(SM_QUERY);

  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const line = buildDayLine(counts).map((item, index) => {
    const words =
      item.target && wide ? (
        <button
          type="button"
          onClick={() => onJumpTo(item.target!)}
          className="hit-area underline decoration-outline-variant underline-offset-4 hover:decoration-primary hover:text-on-surface transition-colors"
        >
          {item.text}
        </button>
      ) : (
        item.text
      );
    if (index === 0)
      return <React.Fragment key={index}>{words}</React.Fragment>;
    // The dot rides with the item after it: the space before the dot is
    // the only place the line may break, so a wrapped line starts with a
    // dot and never ends on one. A screen reader reads the line as one run
    // of text, so the dot pauses it with a comma (`pause`).
    return (
      <React.Fragment key={index}>
        {" "}
        <span className="whitespace-nowrap">
          <MetaDot pause /> {words}
        </span>
      </React.Fragment>
    );
  });

  return (
    <PageHeader
      label="Today summary"
      title={NAMES.pulse.label}
      suffix={date}
      description={quiet ? undefined : line}
      actions={
        <>
          <button
            type="button"
            onClick={() => openQuickNote()}
            className="btn-primary"
          >
            <PenLine className="w-4 h-4" aria-hidden="true" />
            Log note
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
        </>
      }
    />
  );
};
