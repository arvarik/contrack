/**
 * NetworkPage — Where Contrack opens, contacts list defaults, and weather.
 *
 * Start page, list sort, recent contacts, cadence, week start, weather, and temperature unit.
 */
import React from "react";
import { usePreferences } from "../../../contexts/PreferencesContext";
import {
  useRecentContactsLimit,
  MIN_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
} from "../../../hooks/useRecentContacts";
import { Segmented } from "../../../components/ui/Segmented";
import { Switch } from "../../../components/ui/Switch";
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
          id="start-page"
          title="Where Contrack opens"
          prefKey="startPage"
          description="Which page opens on the first visit of a browser session."
        >
          <Segmented
            label="Where Contrack opens"
            value={preferences.startPage}
            onChange={(next) => setPreference("startPage", next)}
            options={[
              { value: "network", label: "Network" },
              { value: "pulse", label: "Pulse" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="list-sort"
          title="Default sort"
          prefKey="listSort"
          description="How the contact list orders itself when you haven't chosen an override."
        >
          <Segmented
            label="Default sort"
            value={preferences.listSort}
            onChange={(next) => setPreference("listSort", next)}
            options={[
              { value: "name", label: "Name" },
              { value: "recent", label: "Recent" },
              { value: "score", label: "Score" },
            ]}
          />
        </SettingRow>

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
          id="cadence"
          title="Default follow-up cadence"
          prefKey="defaultCadenceDays"
          description="How long a contact can go quiet before its relationship score drops. Applies to contacts with no cadence of their own."
        >
          <Segmented
            label="Default follow-up cadence"
            value={preferences.defaultCadenceDays}
            onChange={(next) => setPreference("defaultCadenceDays", next)}
            options={[
              { value: 30, label: "30 days" },
              { value: 60, label: "60 days" },
              { value: 90, label: "90 days" },
              { value: 180, label: "180 days" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="week-start"
          title="Week starts on"
          prefKey="weekStart"
          description="Sets the first day of the week for timeline grouping and activity charts."
        >
          <Segmented
            label="Week starts on"
            value={preferences.weekStart}
            onChange={(next) => setPreference("weekStart", next)}
            options={[
              { value: "monday", label: "Monday" },
              { value: "sunday", label: "Sunday" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="weather"
          title="Local time and weather"
          prefKey="showWeather"
          description="Show local weather on a contact's card. Fetches conditions from Open-Meteo using the contact's coordinates."
        >
          <Switch
            label="Local time and weather"
            checked={preferences.showWeather}
            onChange={(next) => setPreference("showWeather", next)}
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
