/**
 * SearchField — the search box: the glass, the field in `SEARCH_INPUT`, no
 * spelling help, and one clear button.
 *
 * Names, places and companies are not words. A phone that corrects them
 * turns a surname into a word, a red line sits under each name, and "tag:"
 * gains a capital. Thirteen boxes wrote the three attributes by hand, one
 * map toolbar kept its own copy, and the clear buttons came in six looks,
 * two of them without the 44 px tap box. A new search box takes this one,
 * and `tests/unit/frontend/style/stylesFloor.test.ts` checks that every
 * other field turns the help off through `NO_AUTOCORRECT`.
 *
 * @module components/ui/SearchField
 */
import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { Search, X } from "lucide-react";
import { ICON_BTN, SEARCH_INPUT } from "../../lib/styles";
import { cn } from "../../lib/utils";

/**
 * The props of a field whose words are not prose: a search, a name, an
 * email, a username, a link. No spell check, no auto-correct and no
 * capital letter on a phone. Spread it on the field: `{...NO_AUTOCORRECT}`.
 */
export const NO_AUTOCORRECT = {
  spellCheck: false,
  autoCorrect: "off",
  autoCapitalize: "off",
} as const;

/**
 * The X at the end of a search box: 24 px on screen with a 44 px tap box,
 * centered in a `relative` frame.
 */
export const ClearButton = ({
  label,
  onClick,
  className,
}: {
  /** Its name: "Clear search", "Clear filter text". */
  label: string;
  onClick: () => void;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className={cn(
      ICON_BTN,
      "absolute right-2 top-1/2 -translate-y-1/2 p-1",
      className,
    )}
  >
    <X className="w-4 h-4" aria-hidden="true" />
  </button>
);

interface SearchFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className"
> {
  ref?: Ref<HTMLInputElement>;
  /** The frame's classes: its width and its place in the layout. */
  className?: string;
  /** Shows the clear button while the field holds text. */
  onClear?: () => void;
  /** The clear button's name. */
  clearLabel?: string;
  /** Drawn inside the frame after the field, such as a list of matches. */
  children?: ReactNode;
}

export const SearchField = ({
  ref,
  className,
  onClear,
  clearLabel = "Clear search",
  children,
  ...input
}: SearchFieldProps) => (
  <div className={cn("relative", className)}>
    <Search
      aria-hidden="true"
      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none"
    />
    <input
      ref={ref}
      {...NO_AUTOCORRECT}
      {...input}
      className={cn(SEARCH_INPUT, onClear && "pr-10")}
    />
    {onClear && typeof input.value === "string" && input.value !== "" && (
      <ClearButton label={clearLabel} onClick={onClear} />
    )}
    {children}
  </div>
);
