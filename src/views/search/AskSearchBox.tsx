/**
 * AskSearchBox: the search box on Ask Contrack, the same in both modes.
 *
 * People and Notes had two boxes. People had a Search button with a word on
 * it, and Notes had none, so a person who typed a note search and looked
 * for the button found nothing to press. One box now serves both:
 *
 * ```
 * ┌──────────────────────────────────────────────────────┐
 * │ ✦  Ask about your network…                 ×  [ 🔍 ] │
 * └──────────────────────────────────────────────────────┘
 * ```
 *
 * 1. The mode's glyph leads: the sparkles for People, a note for Notes. It
 *    gives way to the page's busy mark while a search runs. The glyph is
 *    decoration, and the page's status region says the same in words.
 * 2. The box is a search landmark and a form. Enter and the button submit
 *    it, so both run the same search. Escape empties the box and what it
 *    found.
 * 3. Clear keeps its slot while there is nothing to clear, so the caret
 *    never moves when the first letter arrives. It is out of the Tab order
 *    and hidden from a screen reader until then.
 * 4. The button is the magnifying glass alone, the page's primary action,
 *    named "Search" for a screen reader and for a pointer. A glyph with a
 *    word beside it said "Search" twice.
 *
 * The card draws the focus ring while the input has focus (`focus-frame`).
 * It is 80 px tall from `sm` in both modes, so switching modes moves
 * nothing under it.
 *
 * @module views/search/AskSearchBox
 */
import React from "react";
import { Search, X, type LucideIcon } from "lucide-react";
import { CARD, ICON_BTN } from "../../lib/styles";
import { cn } from "../../lib/utils";

export interface AskSearchBoxProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  /** Runs the search, from Enter and from the button. */
  onSubmit: () => void;
  /** Empties the box and what it found, from Escape and from Clear. */
  onClear: () => void;
  /** True while there is something to clear: words, or filters behind them. */
  canClear: boolean;
  /** False while the words cannot be searched, or a search of them runs. */
  canSubmit: boolean;
  /** The mode's glyph at the start of the box. */
  icon: LucideIcon;
  /** Drawn in the glyph's place while a search runs. */
  busyMark?: React.ReactNode;
  placeholder: string;
  /** The input's accessible name. */
  label: string;
}

export const AskSearchBox = ({
  inputRef,
  value,
  onChange,
  onSubmit,
  onClear,
  canClear,
  canSubmit,
  icon: Icon,
  busyMark,
  placeholder,
  label,
}: AskSearchBoxProps) => (
  <form
    role="search"
    onSubmit={(event) => {
      event.preventDefault();
      if (canSubmit) onSubmit();
    }}
    className={cn(
      CARD,
      "focus-frame flex items-center gap-3 px-4 sm:px-6 py-2 sm:py-5",
    )}
  >
    <span className="flex shrink-0 text-primary" aria-hidden="true">
      {busyMark ?? <Icon className="w-5 h-5" />}
    </span>
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      // Enter is answered here rather than by the form's own submit, so a
      // search runs the same way wherever the key comes from, and never
      // twice. A key that finishes an IME composition is the composer's.
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          if (canSubmit) onSubmit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClear();
        }
      }}
      placeholder={placeholder}
      aria-label={label}
      // 44 px tall on a phone, the touch floor, and the button's 40 px from
      // `sm`. 16 px type on a phone keeps iOS from zooming in on focus.
      className="flex-1 min-w-0 h-11 sm:h-10 bg-transparent border-none text-on-surface placeholder:text-on-surface-variant text-base sm:text-lg"
    />
    <button
      type="button"
      onClick={onClear}
      tabIndex={canClear ? 0 : -1}
      aria-hidden={!canClear}
      aria-label="Clear search"
      className={cn(
        ICON_BTN,
        "p-1.5 shrink-0 transition-opacity",
        !canClear && "opacity-0 pointer-events-none",
      )}
    >
      <X className="w-5 h-5" aria-hidden="true" />
    </button>
    <button
      type="submit"
      disabled={!canSubmit}
      aria-label="Search"
      title="Search (Enter)"
      className="btn-primary btn-icon shrink-0"
    >
      <Search className="w-5 h-5" aria-hidden="true" />
    </button>
  </form>
);
