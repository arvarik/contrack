/**
 * The search box on Ask Contrack, the same in People and Notes mode, so
 * switching modes moves nothing under it.
 *
 * - The mode's glyph is decorative. The page's status region says the same.
 * - Clear keeps its slot while there is nothing to clear, so the caret never
 *   moves on the first letter. It is out of the Tab order and hidden from a
 *   screen reader until then.
 * - The card draws the focus ring for the input (`focus-frame`).
 */
import React from "react";
import { Search, X, type LucideIcon } from "lucide-react";
import { CARD, ICON_BTN } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { NO_AUTOCORRECT } from "../../components/ui/SearchField";

interface AskSearchBoxProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Measured by the search flight, which keeps out of the column. */
  formRef?: React.Ref<HTMLFormElement>;
  value: string;
  onChange: (value: string) => void;
  /** From Enter and from the button. */
  onSubmit: () => void;
  /** Empties the box and what it found, from Escape and from Clear. */
  onClear: () => void;
  /** True while there is something to clear: words, or filters behind them. */
  canClear: boolean;
  canSubmit: boolean;
  icon: LucideIcon;
  /** Drawn in the glyph's place while a search runs. */
  busyMark?: React.ReactNode;
  placeholder: string;
  /** The input's accessible name. */
  label: string;
}

export const AskSearchBox = ({
  inputRef,
  formRef,
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
    ref={formRef}
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
      enterKeyHint="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      // Enter is answered here, not by the form submit, so a search never
      // runs twice. A key that ends an IME composition belongs to the IME.
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
      {...NO_AUTOCORRECT}
      // 44 px is the touch floor. 16 px type keeps iOS from zooming on focus.
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
