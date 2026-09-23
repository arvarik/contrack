/**
 * AppearancePage — How Contrack looks on this account.
 *
 * Theme, accent colour, text size, motion, the corvid, and list density.
 */
import React from "react";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useListDensity } from "../../../hooks/useListDensity";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { Segmented } from "../../../components/ui/Segmented";
import { AccentPicker } from "../../../components/ui/AccentPicker";
import { SettingRow } from "../SettingRow";
import { SETTINGS_CARD, SETTINGS_PAGE } from "../layout";

/** The OS switch. It wins over both rows below, so both rows say so. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export const AppearancePage = () => {
  const { preferences, setPreference, mode } = usePreferences();
  const { density, setDensity } = useListDensity();
  const osReducesMotion = useMediaQuery(REDUCED_MOTION_QUERY);

  // Either input silences the bird, so the row has to say which one did it.
  // A person who set the OS switch years ago and forgot has no other way to
  // find out why "Full" changes nothing.
  const motionIsReduced = osReducesMotion || preferences.motion === "reduced";

  return (
    <div className={SETTINGS_PAGE}>
      <div className={SETTINGS_CARD}>
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
          description="The colour of links, buttons, and anything that wants your attention. Each one is adjusted to stay readable in light and dark."
        >
          <AccentPicker
            value={preferences.accent}
            mode={mode}
            onChange={(next) => setPreference("accent", next)}
          />
        </SettingRow>

        <SettingRow
          id="text-scale"
          title="Text size"
          prefKey="textScale"
          description={
            preferences.textScale === "large"
              ? "One step larger everywhere, for easier reading."
              : "The standard size."
          }
        >
          <Segmented
            label="Text size"
            value={preferences.textScale}
            onChange={(next) => setPreference("textScale", next)}
            options={[
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="motion"
          title="Motion"
          prefKey="motion"
          description={
            preferences.motion === "reduced"
              ? "Keeps animation to a minimum across the app."
              : "Follows this device's reduced motion setting."
          }
        >
          <Segmented
            label="Motion"
            value={preferences.motion}
            onChange={(next) => setPreference("motion", next)}
            options={[
              { value: "system", label: "System" },
              { value: "reduced", label: "Reduced" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="mascot-motion"
          title="Corvid motion"
          prefKey="mascotMotion"
          description={
            <>
              The bird blinks, hops and flies when you click it. Subtle keeps
              the blinks and drops the flights.
              {motionIsReduced && (
                <>
                  {" "}
                  Motion is reduced, so the corvid stays still whatever you
                  choose here.
                </>
              )}
            </>
          }
        >
          <Segmented
            label="Corvid motion"
            value={preferences.mascotMotion}
            onChange={(next) => setPreference("mascotMotion", next)}
            options={[
              { value: "full", label: "Full" },
              { value: "subtle", label: "Subtle" },
              { value: "off", label: "Off" },
            ]}
          />
        </SettingRow>

        <SettingRow
          id="list-density"
          title="List density"
          prefKey="listDensity"
          description={
            density === "compact"
              ? "More contacts on a screen, with the same details."
              : "Roomier rows that are easier to scan."
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
