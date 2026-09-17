/**
 * AppearancePage — How Contrack looks on this account.
 *
 * Theme, accent colour, and list density.
 */
import React from "react";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useListDensity } from "../../../hooks/useListDensity";
import { Segmented } from "../../../components/ui/Segmented";
import { AccentPicker } from "../../../components/ui/AccentPicker";
import { SettingRow } from "../SettingRow";
import { CARD } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export const AppearancePage = () => {
  const { preferences, setPreference, mode } = usePreferences();
  const { density, setDensity } = useListDensity();

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-6 pb-28 md:pb-10">
      <div className="space-y-1">
        <p className="text-sm text-on-surface-variant">
          How Contrack looks on this account.
        </p>
      </div>

      <div className={cn(CARD, "p-4 sm:p-6 divide-y divide-surface-container")}>
        <SettingRow
          id="theme"
          title="Theme"
          prefKey="theme"
          description={
            preferences.theme === "system"
              ? `Following this device, which is currently ${mode}.`
              : `Always ${preferences.theme}, whatever this device is set to.`
          }
        >
          <Segmented
            label="Theme"
            value={preferences.theme}
            onChange={(next) => setPreference("theme", next)}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="accent"
          title="Accent colour"
          prefKey="accent"
          description="The colour of links, buttons, and anything the app wants you to notice. Every shade is adjusted until it is readable on both palettes."
        >
          <AccentPicker
            value={preferences.accent}
            mode={mode}
            onChange={(next) => setPreference("accent", next)}
          />
        </SettingRow>

        <SettingRow
          id="list-density"
          title="List density"
          prefKey="listDensity"
          description={
            density === "compact"
              ? "Compact — more contacts per screen, same details."
              : "Comfortable — roomier rows, easier to scan."
          }
        >
          <Segmented
            label="List density"
            value={density}
            onChange={setDensity}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </SettingRow>
      </div>
    </div>
  );
};

export default AppearancePage;
