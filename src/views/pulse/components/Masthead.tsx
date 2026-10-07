/**
 * Masthead: the page title, the day, and one line of facts such as
 * "2 overdue · 2 due today · 12 days in a row".
 *
 * From `sm` up each count is a button that jumps to its card. Below `sm` the
 * counts are plain text, because inline 44 px tap boxes would overlap across
 * two wrapped lines. Log note is the one primary action. New contact and
 * Customize layout sit in the More menu, and the `c` key toggles customize.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { Ellipsis, PenLine, SlidersHorizontal, UserPlus } from "lucide-react";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { PageHeader } from "../../../components/layout/PageHeader";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { NAMES } from "../../../lib/names";
import { openQuickNote } from "../../../lib/appEvents";
import {
  buildDayLine,
  type JumpTarget,
  type MastheadCounts,
} from "../lib/dayLine";

export type { JumpTarget };

interface MastheadProps {
  counts: MastheadCounts;
  isEditing: boolean;
  onToggleCustomize: () => void;
  onJumpTo: (target: JumpTarget) => void;
  /** The welcome state: the line of facts is left out. */
  quiet?: boolean;
  /** The More menu's button, where focus goes when customize mode ends. */
  moreRef?: React.Ref<HTMLButtonElement>;
}

/** The Tailwind `sm` breakpoint, where the counts become buttons. */
const SM_QUERY = "(min-width: 640px)";

export const Masthead = ({
  counts,
  isEditing,
  onToggleCustomize,
  onJumpTo,
  quiet = false,
  moreRef,
}: MastheadProps) => {
  const navigate = useNavigate();
  const wide = useMediaQuery(SM_QUERY);

  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const items = buildDayLine(counts).map((item, index) => {
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
    // The dot rides with the item after it in a 1em box, and the line breaks
    // only before a box (`wbr`). A screen reader hears a comma for the dot.
    return (
      <React.Fragment key={index}>
        {index > 0 && <wbr />}
        <span className="whitespace-nowrap">
          <span
            aria-hidden="true"
            className="inline-block w-[1em] text-center whitespace-pre"
          >
            {index > 0 ? " · " : ""}
          </span>
          {index > 0 && <span className="sr-only">, </span>}
          {words}
        </span>
      </React.Fragment>
    );
  });
  /**
   * The line starts 1em left of its box, which clips that strip, so a wrapped
   * line never starts with a dot. The clip reaches past the other edges, so
   * the tap boxes and the focus ring stay whole.
   */
  const line = (
    <span className="block [clip-path:inset(-1rem_-1rem_-1rem_-0.25rem)]">
      <span className="block -ml-[1em]">{items}</span>
    </span>
  );

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
            triggerRef={moreRef}
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
