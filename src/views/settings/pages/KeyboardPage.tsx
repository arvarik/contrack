/**
 * KeyboardPage — Single-key shortcuts and keyboard reference table.
 *
 * Switch for singleKeyShortcuts, plus the full SHORTCUTS table grouped
 * by SHORTCUT_GROUP_ORDER, clearly marking which keys the switch turns off.
 *
 * @module views/settings/pages/KeyboardPage
 */
import React from "react";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { SettingRow } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { groupedShortcuts, type Shortcut } from "../../../lib/shortcuts";
import { ShortcutKeys } from "../../../components/ui/ShortcutKeys";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";
import { SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

/** The chip after a shortcut's name. */
const CHIP =
  "text-[11px] font-semibold px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant";

export const KeyboardPage = () => {
  const { preferences, setPreference } = usePreferences();
  const singleKeysEnabled = preferences.singleKeyShortcuts;
  const groups = groupedShortcuts();

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="single-key-shortcuts"
          title="Single-key shortcuts"
          prefKey="singleKeyShortcuts"
          description="Use keys like /, N, V, J and K without holding a modifier. Turn this off if you set them off by mistake"
          inline
        >
          <Switch
            label="Single-key shortcuts"
            checked={singleKeysEnabled}
            onChange={(next) => setPreference("singleKeyShortcuts", next)}
          />
        </SettingRow>
      </div>

      <section aria-labelledby="all-shortcuts">
        <h2 id="all-shortcuts" className={SETTINGS_SECTION_HEADING}>
          All shortcuts
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-6")}>
          <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
            The switch above turns off every key marked &ldquo;Single key&rdquo;
          </p>

          {groups.map((group) => (
            <section
              key={group.group}
              aria-label={group.group}
              className="space-y-1"
            >
              <h3 className={cn(SECTION_HEADING, "mb-2")}>{group.group}</h3>
              {group.shortcuts.map((s: Shortcut) => {
                const isAffected = s.bareLetter && !s.alwaysOn;
                const isDeactivated = isAffected && !singleKeysEnabled;

                return (
                  <div
                    key={`${group.group}-${s.keys.join("+")}-${s.description}`}
                    className={cn(
                      "flex items-center justify-between gap-4 py-1.5 transition-opacity",
                      isDeactivated && "opacity-50",
                    )}
                  >
                    <div className="min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-on-surface font-medium">
                        {s.description}
                      </span>
                      {isAffected && (
                        <span className={CHIP}>
                          {singleKeysEnabled ? "Single key" : "Off"}
                        </span>
                      )}
                      {s.alwaysOn && <span className={CHIP}>Always on</span>}
                    </div>

                    <div className="shrink-0">
                      <ShortcutKeys keys={s.keys} />
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
};

export default KeyboardPage;
