/**
 * NetworkPage: where Contrack opens, the contact list's defaults, the
 * default cadence, tracking, the week's start and the weather.
 */
import { usePreferences } from "../../../contexts/PreferencesContext";
import {
  useRecentContactsLimit,
  MIN_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
} from "../../../hooks/useRecentContacts";
import {
  cadenceOptions,
  describeCadence,
  isCadenceDays,
} from "../../../../shared/cadence";
import { Segmented } from "../../../components/ui/Segmented";
import { Select } from "../../../components/ui/Select";
import { PrefSwitchRow, SettingRow } from "../SettingRow";
import { SETTINGS_CARD, SETTINGS_PAGE } from "../layout";

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
    "hit-area state-layer w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold transition-colors bg-surface-container disabled:text-on-surface-variant disabled:cursor-not-allowed";
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
    <div className={SETTINGS_PAGE}>
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="start-page"
          title="Where Contrack opens"
          prefKey="startPage"
          description="The page Contrack opens on in a new browser tab"
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
          description="How the contact list sorts until you pick another order"
        >
          <Segmented
            label="Default sort"
            value={preferences.listSort}
            onChange={(next) => setPreference("listSort", next)}
            options={[
              { value: "name", label: "A to Z" },
              { value: "recent", label: "Newest" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="recent-contacts"
          title="Recent contacts"
          prefKey="recentLimit"
          description="How many recently visited contacts pin to the top of your Network. Set it to 0 to hide the row"
          inline
        >
          <Stepper
            label="recent contacts"
            value={recentLimit}
            onChange={setRecentLimit}
            min={MIN_RECENT_LIMIT}
            max={MAX_RECENT_LIMIT}
          />
        </SettingRow>

        {/* A stored cadence off the list (every 2 or 6 months, from before
            2.0) shows as a fifth option, so the select never names a
            default the account does not have. A Select, because five words
            do not fit a Segmented at phone width. */}
        <SettingRow
          id="cadence"
          title="Default cadence"
          prefKey="defaultCadenceDays"
          description="How often you want to keep up with a contact you track. Each contact can have its own"
        >
          <Select
            label="Default cadence"
            align="end"
            wrapperClassName="w-full sm:w-44"
            value={String(preferences.defaultCadenceDays)}
            onChange={(next) => {
              const days = Number(next);
              if (isCadenceDays(days))
                setPreference("defaultCadenceDays", days);
            }}
            options={cadenceOptions(preferences.defaultCadenceDays).map(
              (days) => ({
                value: String(days),
                label: describeCadence(days),
              }),
            )}
          />
        </SettingRow>

        <PrefSwitchRow
          id="track-new"
          title="Track new contacts"
          prefKey="trackNewContacts"
          description="Contacts you add by hand start tracked. Imports and connectors never do"
        />

        <SettingRow
          id="week-start"
          title="Week starts on"
          prefKey="weekStart"
          description="The first day of the week on the timeline and in activity charts"
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

        <PrefSwitchRow
          id="weather"
          title="Weather"
          prefKey="showWeather"
          description="Shows the weather beside a contact's local time. Contrack asks Open-Meteo for the weather where the contact is"
        />

        <SettingRow
          id="temp-unit"
          title="Temperature unit"
          prefKey="tempUnit"
          description="How the weather reads on a contact's card"
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
