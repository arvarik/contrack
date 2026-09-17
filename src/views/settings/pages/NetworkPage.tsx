/**
 * NetworkPage — Where Contrack opens, contacts list defaults, and weather.
 *
 * Recent contacts limit and temperature unit.
 */
import React from "react";
import { usePreferences } from "../../../contexts/PreferencesContext";
import {
  useRecentContactsLimit,
  MIN_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
} from "../../../hooks/useRecentContacts";
import { Segmented } from "../../../components/ui/Segmented";
import { SettingRow } from "../SettingRow";
import { CARD } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export const Stepper = ({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  label: string;
}) => {
  const button =
    "hit-area w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold transition-colors bg-surface-container hover:bg-surface-container-high disabled:text-on-surface-variant disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
        className={button}
      >
        −
      </button>
      <span
        aria-live="polite"
        className="w-7 text-center font-extrabold text-on-surface tabular-nums"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
        className={button}
      >
        +
      </button>
    </div>
  );
};

export const NetworkPage = () => {
  const { preferences, setPreference } = usePreferences();
  const { limit: recentLimit, setLimit: setRecentLimit } =
    useRecentContactsLimit();

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-6 pb-28 md:pb-10">
      <div className="space-y-1">
        <p className="text-sm text-on-surface-variant">
          Where Contrack opens, contacts list defaults, and weather.
        </p>
      </div>

      <div className={cn(CARD, "p-4 sm:p-6 divide-y divide-surface-container")}>
        <SettingRow
          id="recent-contacts"
          title="Recent contacts"
          prefKey="recentLimit"
          description="How many recently visited contacts pin to the top of your Network. Set to 0 to hide the row."
        >
          <Stepper
            label="recent contacts"
            value={recentLimit}
            onChange={setRecentLimit}
            min={MIN_RECENT_LIMIT}
            max={MAX_RECENT_LIMIT}
          />
        </SettingRow>

        <SettingRow
          id="temp-unit"
          title="Temperature unit"
          prefKey="tempUnit"
          description="How weather reads on a contact's local-time badge."
        >
          <Segmented
            label="Temperature unit"
            value={preferences.tempUnit}
            onChange={(next) => setPreference("tempUnit", next)}
            options={[
              { value: "celsius", label: "°C" },
              { value: "fahrenheit", label: "°F" },
            ]}
          />
        </SettingRow>
      </div>
    </div>
  );
};

export default NetworkPage;
