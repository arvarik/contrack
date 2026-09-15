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
 *
 * It is one control with one Tab stop. It used to be an `aria-hidden` strip
 * plus a visually hidden list of thirteen buttons for keyboards, which gave a
 * sighted keyboard user thirteen Tab presses with nothing on screen moving.
 * Now the visible letters are the buttons: Tab reaches the rail once, the
 * arrow keys move between letters and jump the list as they go, and a letter
 * key jumps straight to it. Letters with no contacts are not rendered, so
 * every stop the arrows reach does something.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
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
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const lastJumped = useRef<string | null>(null);

  /** Only the letters that have contacts, in rail order. */
  const letters = useMemo(
    () => LETTERS.filter((letter) => index.has(letter)),
    [index],
  );

  /**
   * The letter that owns the Tab stop.
   *
   * While the keyboard is moving through the rail it is the letter last moved
   * to. Otherwise it follows the list, so Tab into the rail starts at the
   * letter already on screen.
   */
  const [keyboardLetter, setKeyboardLetter] = useState<string | null>(null);
  const tabStop =
    (keyboardLetter && letters.includes(keyboardLetter) && keyboardLetter) ||
    (activeBucket && letters.includes(activeBucket) && activeBucket) ||
    letters[0];

  const jumpTo = useCallback(
    (letter: string) => {
      const target = index.get(letter);
      if (target !== undefined) onJump(target);
    },
    [index, onJump],
  );

  /**
   * Resolve a pointer position to a letter.
   *
   * Reads the letter nearest the finger rather than tracking which element
   * received the event, because a touch that starts on "M" and slides to "R"
   * never fires events on "R" — the browser keeps delivering them to "M".
   */
  const jumpToPointer = useCallback(
    (clientY: number) => {
      // The nearest rendered letter, measured, not computed from slots: only
      // letters with contacts are drawn, so the rail no longer has 27 evenly
      // spaced positions to divide by.
      let letter: string | null = null;
      let nearest = Infinity;
      for (const [candidate, element] of buttons.current) {
        const { top, height } = element.getBoundingClientRect();
        const distance = Math.abs(clientY - (top + height / 2));
        if (distance < nearest) {
          nearest = distance;
          letter = candidate;
        }
      }
      if (!letter || letter === lastJumped.current) return;
      lastJumped.current = letter;
      jumpTo(letter);
    },
    [jumpTo],
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

  /** Move the Tab stop to a letter, focus it, and jump the list there. */
  const moveTo = (letter: string) => {
    setKeyboardLetter(letter);
    buttons.current.get(letter)?.focus();
    jumpTo(letter);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = letters.indexOf(event.currentTarget.dataset.letter ?? "");
    if (current === -1) return;
    let next: string | undefined;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = letters[Math.min(current + 1, letters.length - 1)];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = letters[Math.max(current - 1, 0)];
        break;
      case "Home":
        next = letters[0];
        break;
      case "End":
        next = letters[letters.length - 1];
        break;
      default: {
        const typed = event.key.length === 1 ? event.key.toUpperCase() : "";
        if (typed && letters.includes(typed)) next = typed;
      }
    }
    if (!next) return;
    event.preventDefault();
    moveTo(next);
  };

  if (letters.length === 0) return null;

  return (
    <div
      ref={railRef}
      role="group"
      aria-label="Jump to letter"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => (lastJumped.current = null)}
      onBlur={(event) => {
        // Leaving the rail hands the Tab stop back to the list's position.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setKeyboardLetter(null);
        }
      }}
      // `touch-none` stops the browser treating a vertical drag on the rail as
      // a page scroll, which would fight the jump.
      //
      // The bottom padding matches the list's own `pb-24`: the rail spans the
      // full list area, which on a phone extends underneath the fixed tab bar,
      // so without it the last few letters are rendered where they cannot be
      // tapped.
      className="absolute right-0 top-0 bottom-0 z-20 flex w-6 select-none touch-none flex-col items-center justify-center pt-2 pb-24 md:pb-2"
    >
      {letters.map((letter) => (
        <button
          key={letter}
          type="button"
          ref={(element) => {
            if (element) buttons.current.set(letter, element);
            else buttons.current.delete(letter);
          }}
          data-letter={letter}
          tabIndex={letter === tabStop ? 0 : -1}
          aria-current={letter === activeBucket ? "true" : undefined}
          aria-label={letter === OTHER_BUCKET ? "# (other characters)" : letter}
          onClick={() => jumpTo(letter)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-h-0 max-h-6 w-6 flex items-center justify-center rounded-full"
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
            aria-hidden="true"
            className={cn(
              "flex items-center justify-center rounded-full text-[9px] font-bold leading-none transition-colors",
              letter === activeBucket
                ? "w-4 h-4 bg-primary text-on-primary"
                : "text-on-surface-variant",
            )}
          >
            {letter}
          </span>
        </button>
      ))}
    </div>
  );
};
