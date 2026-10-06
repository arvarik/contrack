/**
 * The jump-to-letter strip down the edge of the contact list.
 *
 * - It jumps by index, never by offset: unmeasured rows have only estimated
 *   offsets.
 * - Its highlighted letter is the "where am I" sign, in place of sticky
 *   section headers.
 * - A thumb can drag down it as well as tap.
 * - It is one Tab stop. Arrows move between letters and jump the list, and a
 *   letter key jumps to that letter. Only letters with contacts render.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";

/** Non-alphabetic names (numbers, symbols, other scripts) bucket under "#". */
const OTHER_BUCKET = "#";

const LETTERS = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  OTHER_BUCKET,
];

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
  /** The room a bar over the list's end takes, so no letter sits under it. */
  bottomRoom?: number;
}

const AlphabetRailInner = ({
  index,
  activeBucket,
  onJump,
  bottomRoom,
}: AlphabetRailProps) => {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const lastJumped = useRef<string | null>(null);

  const letters = useMemo(
    () => LETTERS.filter((letter) => index.has(letter)),
    [index],
  );

  // The Tab stop: the letter the keys last moved to, or else the letter on
  // screen.
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

  // The letter nearest the finger, measured. The event target cannot say: a
  // touch that starts on "M" and slides to "R" keeps firing on "M".
  const jumpToPointer = useCallback(
    (clientY: number) => {
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
    // Capture keeps the drag arriving here. It throws NotFoundError for a
    // pointer the browser does not track (synthetic events, some assistive
    // tech): the drag becomes a tap, and the tap still works.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Taps still work.
    }
    lastJumped.current = null;
    jumpToPointer(event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (event.buttons === 0) return; // hovering, not dragging
    jumpToPointer(event.clientY);
  };

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
      // `touch-none`: a vertical drag is a jump, not a page scroll. The bottom
      // padding matches the list's `pb-24`, so no letter sits under the
      // phone's tab bar (or the bulk bar). A short window has no room for
      // the letters, so the rail hides there.
      className="absolute right-0 top-0 bottom-0 z-20 flex w-6 select-none touch-none flex-col items-center justify-center pt-2 pb-24 md:pb-2 [@media(max-height:499px)]:hidden"
      style={bottomRoom ? { paddingBottom: bottomRoom } : undefined}
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
          // A press jumps on pointerdown, and its click can land on the next
          // letter's overlapping tap box. So only a key's click (`detail` 0)
          // jumps here.
          onClick={(event) => event.detail === 0 && jumpTo(letter)}
          onKeyDown={handleKeyDown}
          // Tap boxes overlap, which costs nothing: a press reads the nearest
          // letter. The focus ring is inside, since the pane's clipped edge
          // would cut an outside one. The letter sits 2 px in from that edge,
          // and its tap box (`after:`) does not.
          className="hit-area flex-1 min-h-0 max-h-6 w-6 flex items-center justify-center rounded-full focus-visible:-outline-offset-2 -translate-x-0.5 after:translate-x-0.5"
        >
          {/* A filled circle on the active letter: a color change alone is
              easy to miss at 11 px, and a marker over the list covers names.
          */}
          <span
            aria-hidden="true"
            className={cn(
              "flex items-center justify-center rounded-full text-[11px] font-bold leading-none transition-colors",
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

// The list renders on each scroll. The rail redraws only when its props change.
export const AlphabetRail = React.memo(AlphabetRailInner);
