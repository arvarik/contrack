/**
 * SettingRow — an addressable row for one setting or preference.
 *
 * Each setting sits in a SettingRow with an id. Hash links scroll to the row
 * and flash its background once for 1.2 seconds: the selected tint, with no
 * ring, since a ring is the focus ring's look.
 *
 * Rows sit on a card and space themselves apart: 32 px between two rows and
 * no line, since "Lines are a failure of hierarchy". The flash reaches 12 px
 * past the text on each side, so the words do not touch its edge.
 *
 * The control sits at the row's right edge from `sm`. On a phone a wide
 * control (a `Segmented`, a `Select`) drops under the text and takes the
 * row's width, and a small one (a `Switch`, a stepper) stays beside the
 * title when the row is `inline`, the way a phone's own settings draw it.
 * A control too wide for the edge at any width (a grid of choices, a field
 * and its button) sits under the text when the row is `below`.
 *
 * A preference whose value is not its default says so with one quiet mark:
 * a 6 px accent dot after the title (`CHANGED_MARK`), named "Changed from
 * the default" for a screen reader and a pointer. The row tells the page
 * which key it holds (`useResetScopeKey`), and the page ends with one
 * "Reset to defaults" button while any of its keys is changed
 * (`ResetToDefaults`). A value set back to its default by hand takes its
 * dot away, and the button goes with the last one.
 *
 * That pair is the app's one way of showing a value that is off its default.
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { Preferences } from "../../api/preferences";
import { cn } from "../../lib/utils";
import { CHANGED_MARK } from "../../lib/styles";
import { useResetScopeKey } from "./ResetToDefaults";

export interface SettingRowProps {
  /** Stable kebab-case fragment id. */
  id: string;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
  control?: React.ReactNode;
  /** Key in Preferences if this row controls an account preference. */
  prefKey?: keyof Preferences;
  /**
   * The control is small (a switch, a stepper), so on a phone it stays at
   * the right of the title instead of dropping under the text.
   */
  inline?: boolean;
  /** The control is wide, so it sits under the text at every width. */
  below?: boolean;
  className?: string;
}

export const CHANGED_LABEL = "Changed from the default";

/**
 * The target of a settings search result: when the location's hash is `id`,
 * scroll the element into view, give it focus for a screen reader, and
 * flash it for 1.2 seconds. `SettingRow` uses it, and so does any other
 * element a search result links to (an Account section, a General card).
 * Give the element `tabIndex={-1}` so it can take the focus.
 */
export function useHashTarget<T extends HTMLElement>(id: string) {
  const location = useLocation();
  const ref = useRef<T>(null);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const targetHash = `#${id}`;
    if (location.hash === targetHash || window.location.hash === targetHash) {
      setFlashing(true);
      ref.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
      });
      ref.current?.focus?.({ preventScroll: true });
      const timer = setTimeout(() => setFlashing(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [id, location.hash]);

  return { ref, flashing };
}

export const SettingRow = ({
  id,
  title,
  description,
  children,
  control,
  prefKey,
  inline = false,
  below = false,
  className,
}: SettingRowProps) => {
  const { changed } = usePreferences();
  const { ref: rowRef, flashing } = useHashTarget<HTMLDivElement>(id);
  useResetScopeKey(prefKey, rowRef);

  const isChanged = prefKey ? changed.includes(prefKey) : false;
  const controlNode = control ?? children;

  return (
    <div
      id={id}
      ref={rowRef}
      tabIndex={-1}
      className={cn(
        // No outline: the row is a scroll target that takes focus for a
        // screen reader, not a control, and the flash below is its
        // highlight.
        "scroll-mt-20 outline-none rounded-xl transition-colors duration-(--dur-slow)",
        // 12 px of room each side for the flash, taken back by the margin,
        // and 32 px between two rows. The first and the last row keep 8 px
        // above and below for the flash, inside the card's own padding.
        "-mx-3 px-3 py-4 first:-mt-2 first:pt-2 last:-mb-2 last:pb-2",
        flashing && "flash bg-primary/10",
        className,
      )}
    >
      <div
        className={cn(
          "flex gap-3",
          below
            ? "flex-col"
            : cn(
                "sm:flex-row sm:items-center sm:justify-between",
                inline ? "flex-row items-start justify-between" : "flex-col",
              ),
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-on-surface">{title}</h3>
            {isChanged && (
              <span
                role="img"
                aria-label={CHANGED_LABEL}
                title={CHANGED_LABEL}
                className={CHANGED_MARK}
              />
            )}
          </div>
          <div className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
            {description}
          </div>
        </div>
        {controlNode &&
          (below ? (
            <div className="min-w-0">{controlNode}</div>
          ) : (
            <div className="shrink-0 sm:ml-4 flex items-center gap-2">
              {controlNode}
            </div>
          ))}
      </div>
    </div>
  );
};

export default SettingRow;
