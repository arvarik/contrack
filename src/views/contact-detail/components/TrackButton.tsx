/**
 * TrackButton: whether a person keeps up with this contact, and how often.
 *
 * A split button. The word is the action a person takes most, and the caret
 * holds its close relatives, which is the shape this pair has wanted since
 * the cadence arrived:
 *
 * ```
 *   untracked                    tracked
 *   ┌──────────────────┐         ┌──────────────────┐
 *   │ ◎ Track     │ ▾  │         │ ◎ Tracked   │ ▾  │
 *   └──────────────────┘         └──────────────────┘
 *     press: track at the          press: stop tracking
 *     default cadence              caret: change the cadence
 *     caret: track at a
 *     cadence you pick
 * ```
 *
 * 1. The word is a toggle with `aria-pressed`: Track when off, Tracked when
 *    on. Off it is the container fill, on it is the selected tint that every
 *    toggle wears when it is on, with the Radar glyph in the accent. Both
 *    halves are flat and hover with the one state layer.
 * 2. The caret is `CadenceMenu`, a real button with `aria-haspopup` and
 *    `aria-expanded`, divided from the word by a hairline. It is there in
 *    both states and means the same thing in both: how often.
 *
 * **One shape, and the word does not move.** The caret does not appear on
 * press, so the control never changes shape, and there is no dead space
 * holding a place for it. The label is sized to the longer of the two words
 * with the current one drawn over it, so "Track" and "Tracked" start at the
 * same pixel and the shell keeps one width. That matters because the
 * header's cluster is right-aligned: a control that grows drags its own
 * label out from under the pointer. `tests/e2e/contact.spec.ts` measures
 * the box before and after the press.
 *
 * The narrow header has room for the glyph alone: the word moves into the
 * accessible name and the tooltip, and the caret stays.
 *
 * Pressing the word runs `useTrackToggle`, which toasts with an Undo. The
 * ring around the avatar appears or goes with the flag, because both read
 * the same contact. The "Contact actions" menu gets no Track item: one
 * control per concept.
 */
import { Radar } from "lucide-react";
import { cn } from "../../../lib/utils";
import { SELECTED_TINT } from "../../../lib/styles";
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
 * On: the selected tint. The ink stays on hover, so the caret half does not
 * take the menu button's hover ink and read as off.
 */
const ON = cn(SELECTED_TINT, "hover:text-on-primary-wash");

/** Off: the container fill. */
const OFF = "bg-surface-container-high text-on-surface";

export const TrackButton = ({
  contact,
  compact = false,
  className,
}: TrackButtonProps) => {
  const { toggle, isPending } = useTrackToggle();
  const on = contact.isTracked;
  const word = on ? "Tracked" : "Track";
  const half = cn("state-layer transition-colors", on ? ON : OFF);

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
          "hit-area inline-flex items-center justify-start gap-2 rounded-l-md disabled:opacity-50",
          // Narrow, the control keeps the 32 px height of an icon button and
          // takes its 44 px tap box from `hit-area`. Forcing the box itself
          // to 44 px made the header taller and left the company field on
          // the line below within 20 px of it, which is an axe target-size
          // failure on a phone (WCAG 2.5.8).
          compact ? "p-2" : "min-h-[44px] sm:min-h-[40px] py-2 pl-5 pr-3",
          half,
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

      {/* The hairline between the word and the caret: the primary's own
          tint while tracked, else the light line token. */}
      <CadenceMenu
        contact={contact}
        className={cn(
          half,
          on ? "border-primary/25" : "border-outline-variant",
        )}
      />
    </div>
  );
};
