/**
 * TrackButton: the one control that says whether a person keeps up with
 * this contact, and how often.
 *
 * One control, two parts, in one rounded shell:
 *
 * ```
 *   untracked            tracked
 *   ┌──────────────┐     ┌──────────────┐
 *   │ ◎ Track      │     │ ◎ Tracked │ ▾│   the blue wash, and the caret
 *   └──────────────┘     └──────────────┘
 * ```
 *
 * 1. The word is a toggle button with `aria-pressed`: Track when off,
 *    Tracked when on. Off it is `.btn-secondary`. On it takes the primary
 *    wash the "New" button wears, with the Radar glyph in the accent.
 * 2. The caret opens the cadence menu (CadenceMenu), and shows only while
 *    the contact is tracked, because an untracked contact has no cadence
 *    anybody can see.
 *
 * **The word does not move when the state changes.** The cluster in the
 * header is right-aligned, so a control that grows pushes its own label
 * leftward: pressing Track would slide the word under the reader's cursor.
 * Two things hold it still. The caret's slot is always there, empty and
 * hidden while untracked, and the label is sized to the longer of the two
 * words with the shorter one drawn over it. Both states are therefore the
 * same width to the pixel, so the shell's left edge, the glyph and the word
 * all stay exactly where they were. `tests/e2e/contact.spec.ts` measures the
 * word's position before and after the press.
 *
 * The narrow header has room for the glyph alone: the word moves into the
 * accessible name and the tooltip, and the caret slot stays.
 *
 * Pressing the word runs `useTrackToggle`, which toasts with an Undo. The
 * ring around the avatar appears or goes with the flag, because both read
 * the same contact. The "Contact actions" menu gets no Track item: one
 * control per concept.
 */
import { Radar } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  useTrackToggle,
  type TrackableContact,
} from "../../../hooks/useTrackToggle";
import { CadenceMenu } from "./CadenceMenu";

export interface TrackButtonProps {
  contact: TrackableContact;
  /** The narrow header: the glyph alone, with the word in the name. */
  compact?: boolean;
  className?: string;
}

/**
 * The caret's width, and the width of the empty slot that holds its place
 * while the contact is untracked. The two must stay equal: see the note on
 * the word not moving, above.
 */
export const CARET_SLOT = "w-9";

/** The primary wash of the on state, as the "New" button wears it. */
const ON =
  "bg-primary/10 text-on-primary-wash hover:bg-primary/20 transition-colors disabled:opacity-50";

/** The off state, which is `.btn-secondary` without its own rounding. */
const OFF =
  "bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-50";

export const TrackButton = ({
  contact,
  compact = false,
  className,
}: TrackButtonProps) => {
  const { toggle, isPending } = useTrackToggle();
  const on = contact.isTracked;
  const word = on ? "Tracked" : "Track";

  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-md text-sm font-bold",
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={on}
        aria-label={compact ? word : undefined}
        title={compact ? word : undefined}
        disabled={isPending}
        onClick={() => toggle(contact)}
        className={cn(
          "hit-area inline-flex items-center justify-start gap-2 rounded-l-md",
          // Narrow, the control keeps the 32 px height of an icon button and
          // takes its 44 px tap box from `hit-area`. Forcing the box itself
          // to 44 px made the header taller and left the company field on
          // the line below within 20 px of it, which is an axe target-size
          // failure on a phone (WCAG 2.5.8).
          compact ? "p-2" : "min-h-[44px] sm:min-h-[40px] py-2 pl-5 pr-3",
          on ? ON : OFF,
        )}
      >
        <Radar
          aria-hidden="true"
          className={cn("w-4 h-4 shrink-0", on && "text-primary")}
        />
        {!compact && (
          // One cell, two layers: the longer word sets the width and the
          // current one is drawn over it, so the text starts at the same
          // place whichever word it is.
          <span className="grid">
            <span
              aria-hidden="true"
              className="col-start-1 row-start-1 invisible"
            >
              Tracked
            </span>
            <span className="col-start-1 row-start-1 text-left">{word}</span>
          </span>
        )}
      </button>

      {on ? (
        <CadenceMenu contact={contact} />
      ) : (
        // The caret's place, held open so the word above does not move when
        // the caret arrives. Hidden, so it is neither drawn nor clickable
        // and no screen reader meets it.
        <span aria-hidden="true" className={cn(CARET_SLOT, "invisible")} />
      )}
    </div>
  );
};
