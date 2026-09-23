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
 *
 * A preference with a stored key is not at its default. The row says so in
 * two quiet places instead of a line of its own under the description, which
 * used to change the row's height and read like a footnote:
 *
 * 1. A 6 px accent dot after the title (`CHANGED_MARK`), named "Changed from
 *    the default" for a screen reader and a pointer.
 * 2. A "Reset" text button (`BTN_QUIET`) at the start of the control cluster,
 *    so the control itself keeps its place on the row's right edge whether
 *    the button is there or not.
 *
 * That pair is the app's one way of showing a value that is off its default.
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { Preferences } from "../../api/preferences";
import { cn } from "../../lib/utils";
import { BTN_QUIET, CHANGED_MARK } from "../../lib/styles";

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
  className,
}: SettingRowProps) => {
  const { stored, resetPreference } = usePreferences();
  const { ref: rowRef, flashing } = useHashTarget<HTMLDivElement>(id);

  const isChanged = prefKey ? stored.includes(prefKey) : false;
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
          "flex gap-3 sm:flex-row sm:items-center sm:justify-between",
          inline ? "flex-row items-start justify-between" : "flex-col",
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
        {(controlNode || isChanged) && (
          <div className="shrink-0 sm:ml-4 flex items-center gap-2">
            {isChanged && prefKey && (
              <button
                type="button"
                onClick={() => resetPreference(prefKey)}
                className={BTN_QUIET}
                title={`Reset ${title} to default`}
              >
                <RotateCcw aria-hidden="true" className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
            {controlNode}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingRow;
