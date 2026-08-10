/**
 * AlphabetRail — the jump-to-letter strip down the edge of the contact list.
 *
 * Why it exists: the list virtualizes, so it stays fast at any size, but fast
 * is not the same as navigable. A five-hundred-contact network is sixty
 * screens of scrolling with no landmarks, and the reason nobody experiences
 * that in their phone's address book is this control.
 *
 * Two details that matter:
 *
 *   - It scrolls by *index*, never by offset. Rows are measured lazily by the
 *     virtualizer, so any offset computed for a letter far down the list is a
 *     guess based on estimates and lands in the wrong place. `scrollToIndex`
 *     is the virtualizer's own job and it gets it right.
 *   - It doubles as the "where am I" indicator, which is what sticky section
 *     headers would otherwise be for. Highlighting the active letter as the
 *     list scrolls gives the same orientation without a second, flatter data
 *     model for the virtualizer to iterate.
 *
 * Dragging works as well as tapping — on a phone the natural gesture is to
 * run a thumb down the strip, and a control that only responds to discrete
 * taps feels broken under that gesture.
 */
import React, { useCallback, useRef } from "react";
import { cn } from "../../lib/utils";

/** Non-alphabetic names (numbers, symbols, other scripts) bucket under "#". */
export const OTHER_BUCKET = "#";

const LETTERS = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  OTHER_BUCKET,
];

/** The bucket a name belongs to. */
export function bucketFor(name: string): string {
  const first = (name ?? "").trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : OTHER_BUCKET;
}

interface AlphabetRailProps {
  /** Bucket → index of its first contact in the rendered list. */
  index: Map<string, number>;
  /** Bucket currently at the top of the viewport, for the active highlight. */
  activeBucket: string | null;
  /** Scroll the list so `index` is the first visible row. */
  onJump: (index: number) => void;
}

export const AlphabetRail = ({
  index,
  activeBucket,
  onJump,
}: AlphabetRailProps) => {
  const railRef = useRef<HTMLDivElement>(null);
  const lastJumped = useRef<string | null>(null);

  /**
   * Resolve a pointer position to a letter.
   *
   * Reads the letter under the finger rather than tracking which element
   * received the event, because a touch that starts on "M" and slides to "R"
   * never fires events on "R" — the browser keeps delivering them to "M".
   */
  const jumpToPointer = useCallback(
    (clientY: number) => {
      const rail = railRef.current;
      if (!rail) return;
      const { top, height } = rail.getBoundingClientRect();
      const ratio = (clientY - top) / height;
      const position = Math.floor(ratio * LETTERS.length);
      const letter =
        LETTERS[Math.min(Math.max(position, 0), LETTERS.length - 1)];
      if (!letter || letter === lastJumped.current) return;

      const target = index.get(letter);
      if (target === undefined) return; // empty bucket — ignore rather than jump somewhere arbitrary
      lastJumped.current = letter;
      onJump(target);
    },
    [index, onJump],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    // Capture so the whole drag keeps arriving here even as the finger moves
    // off the element it started on.
    //
    // Guarded: setPointerCapture throws NotFoundError for a pointerId the
    // browser is not tracking — synthetic events, and some assistive tech.
    // Losing capture degrades a drag to a tap, which is fine; letting the
    // throw escape would break the tap as well.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Drag tracking unavailable — taps still work.
    }
    lastJumped.current = null;
    jumpToPointer(event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (event.buttons === 0) return; // hovering, not dragging
    jumpToPointer(event.clientY);
  };

  return (
    <div
      ref={railRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => (lastJumped.current = null)}
      // `touch-none` stops the browser treating a vertical drag on the rail as
      // a page scroll, which would fight the jump.
      //
      // The bottom padding matches the list's own `pb-24`: the rail spans the
      // full list area, which on a phone extends underneath the fixed tab bar,
      // so without it the last few letters are rendered where they cannot be
      // tapped.
      className="absolute right-0 top-0 bottom-0 z-20 flex w-6 select-none touch-none flex-col items-center justify-center pt-2 pb-24 md:pb-2"
      aria-hidden="true"
    >
      {LETTERS.map((letter) => {
        const present = index.has(letter);
        return (
          <span
            key={letter}
            className="flex-1 min-h-0 flex items-center justify-center"
          >
            {/*
              The active letter wears a filled circle.

              A colour change alone is easy to miss at 9px on a strip this
              narrow, which is why a floating letter marker was tried over the
              list first. That marker covered contact names and the "Recent"
              heading, so the indicator belongs on the rail itself, where it
              blocks nothing. The circle is 16px, larger than the glyph, so the
              current position reads at a glance without the letters moving.
            */}
            <span
              className={cn(
                "flex items-center justify-center rounded-full text-[9px] font-bold leading-none transition-colors",
                letter === activeBucket
                  ? "w-4 h-4 bg-primary text-on-primary"
                  : "text-on-surface-variant",
              )}
            >
              {/*
              Letters with no contacts render as a dot rather than dimmed text.
              Faded-out text was the obvious first move and measured 1.57:1 —
              invisible, and flagged by `npm run audit:contrast`. A dot is a
              graphic rather than text, so it carries no legibility burden, it
              keeps the 27 evenly-spaced slots the pointer maths depends on,
              and it is what a phone address book does anyway.
            */}
              {present ? (
                letter
              ) : (
                <span className="h-[3px] w-[3px] rounded-full bg-on-surface-variant/40" />
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/**
 * Keyboard-accessible equivalent of the rail.
 *
 * The rail itself is `aria-hidden` and pointer-driven: 27 tab stops in front
 * of the contact list would be a worse experience for a keyboard user than
 * the list's existing arrow-key navigation. This renders the same jumps as
 * real buttons for assistive tech, visually hidden.
 */
export const AlphabetJumpButtons = ({
  index,
  onJump,
}: Pick<AlphabetRailProps, "index" | "onJump">) => (
  <div className="sr-only">
    <h2>Jump to letter</h2>
    {LETTERS.filter((letter) => index.has(letter)).map((letter) => (
      <button
        key={letter}
        type="button"
        onClick={() => onJump(index.get(letter)!)}
      >
        {letter === OTHER_BUCKET ? "Other" : letter}
      </button>
    ))}
  </div>
);
