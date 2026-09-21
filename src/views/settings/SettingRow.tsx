/**
 * SettingRow — an addressable row for one setting or preference.
 *
 * Each setting sits in a SettingRow with an id. Hash links scroll to the row
 * and flash its background once for 1.2 seconds.
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
  className?: string;
}

export const CHANGED_LABEL = "Changed from the default";

export const SettingRow = ({
  id,
  title,
  description,
  children,
  control,
  prefKey,
  className,
}: SettingRowProps) => {
  const location = useLocation();
  const { stored, resetPreference } = usePreferences();
  const [flashing, setFlashing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const isChanged = prefKey ? stored.includes(prefKey) : false;
  const controlNode = control ?? children;

  useEffect(() => {
    const targetHash = `#${id}`;
    if (location.hash === targetHash || window.location.hash === targetHash) {
      setFlashing(true);
      rowRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
      });
      rowRef.current?.focus?.();
      const timer = setTimeout(() => setFlashing(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [id, location.hash]);

  return (
    <div
      id={id}
      ref={rowRef}
      tabIndex={-1}
      className={cn(
        "scroll-mt-20 outline-none rounded-xl transition-colors duration-300",
        "py-4 first:pt-0 last:pb-0",
        flashing && "flash ring-2 ring-primary/40 bg-primary/10",
        className,
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
