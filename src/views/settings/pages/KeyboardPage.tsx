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
import {
  groupedShortcuts,
  isCombination,
  type Shortcut,
} from "../../../lib/shortcuts";
import { CARD, SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-1.5 bg-surface-container-high rounded-md text-[11px] font-mono font-bold text-on-surface shadow-[0_1px_0_0_rgba(0,0,0,0.12)] border border-black/8">
    {children}
  </kbd>
);

export const KeyboardPage = () => {
  const { preferences, setPreference } = usePreferences();
  const singleKeysEnabled = preferences.singleKeyShortcuts;
  const groups = groupedShortcuts();

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-6 pb-28 md:pb-10">
      <div className="space-y-1">
        <p className="text-sm text-on-surface-variant">
          Single-key shortcuts and keyboard reference table.
        </p>
      </div>

      <div className={cn(CARD, "p-4 sm:p-6")}>
        <SettingRow
          id="single-key-shortcuts"
          title="Single-key shortcuts"
          prefKey="singleKeyShortcuts"
          description="Use bare keys like /, N, V, J, and K without holding a modifier. Turn off if you frequently trigger shortcuts by mistake."
        >
          <Switch
            label="Single-key shortcuts"
            checked={singleKeysEnabled}
            onChange={(next) => setPreference("singleKeyShortcuts", next)}
          />
        </SettingRow>
      </div>

      <div className={cn(CARD, "p-4 sm:p-6 space-y-8")}>
        <div className="border-b border-surface-container pb-4">
          <h2 className={SECTION_HEADING}>Shortcuts reference</h2>
          <p className="text-xs text-on-surface-variant mt-1">
            Keys marked with &ldquo;Single key&rdquo; are turned off when the
            single-key shortcuts switch above is disabled.
          </p>
        </div>

        {groups.map((group) => (
          <section
            key={group.group}
            aria-label={group.group}
            className="space-y-3"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {group.group}
            </h3>
            <div className="divide-y divide-surface-container/60">
              {group.shortcuts.map((s: Shortcut) => {
                const isAffected = s.bareLetter && !s.alwaysOn;
                const isDeactivated = isAffected && !singleKeysEnabled;

                return (
                  <div
                    key={`${group.group}-${s.keys.join("+")}-${s.description}`}
                    className={cn(
                      "flex items-center justify-between gap-4 py-2.5 transition-opacity",
                      isDeactivated && "opacity-50",
                    )}
                  >
                    <div className="min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-on-surface font-medium">
                        {s.description}
                      </span>
                      {isAffected && (
                        <span
                          className={cn(
                            "text-[11px] font-semibold px-2 py-0.5 rounded-md",
                            singleKeysEnabled
                              ? "bg-surface-container text-on-surface-variant"
                              : "bg-error/10 text-error",
                          )}
                        >
                          {singleKeysEnabled ? "Single key" : "Off"}
                        </span>
                      )}
                      {s.alwaysOn && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant">
                          Always on
                        </span>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <React.Fragment key={i}>
                          <Kbd>{k}</Kbd>
                          {i < s.keys.length - 1 &&
                            (isCombination(s.keys) ? (
                              <span
                                className="text-[11px] text-on-surface-variant mx-0.5"
                                aria-hidden="true"
                              >
                                +
                              </span>
                            ) : (
                              <span className="text-[11px] text-on-surface-variant mx-0.5">
                                or
                              </span>
                            ))}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default KeyboardPage;
