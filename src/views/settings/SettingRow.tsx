/**
 * SettingRow — an addressable row for one setting or preference.
 *
 * Each setting sits in a SettingRow with an id. Hash links scroll to the row
 * and flash its background once for 1.2 seconds. A preference with a stored
 * key shows a changed indicator and a Reset button.
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { Preferences } from "../../api/preferences";
import { cn } from "../../lib/utils";

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

  const isStored = prefKey ? stored.includes(prefKey) : false;
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
        flashing && "flash ring-2 ring-primary/40 bg-primary/10 px-3 -mx-3",
        className,
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-sm text-on-surface">{title}</h3>
          <div className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
            {description}
          </div>
        </div>
        {controlNode && <div className="shrink-0 sm:ml-4">{controlNode}</div>}
      </div>

      {isStored && prefKey && (
        <div className="flex items-center gap-2 mt-2 pt-1">
          <span
            className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant"
            title="Changed from the default"
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
              aria-hidden="true"
            />
            <span>Changed from the default</span>
          </span>
          <button
            type="button"
            onClick={() => resetPreference(prefKey)}
            className="hit-area text-xs font-semibold text-primary hover:underline ml-2"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
};

export default SettingRow;
