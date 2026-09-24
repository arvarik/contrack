/**
 * DuplicatesPage — find and merge contacts that are the same person.
 *
 * The tool comes first, and what runs by itself comes after it, the way
 * Google Contacts, HubSpot and Dex lay out their duplicates pages:
 *
 * ```
 * Duplicates                                              [ ⟲ ]
 * Find and merge contacts that are the same person
 *
 * ┌ 4 possible duplicates ─────────────────── Review them → ┐   when any wait
 * [ Scan | Manual merge ]
 * ┌──────────────────────────────────────────────────────────┐
 * │ ◉ Quick scan     ○ Smart scan     ○ Full scan            │
 * │                                            [ Scan now ]  │
 * └──────────────────────────────────────────────────────────┘
 * AUTOMATIC MERGING
 * ┌──────────────────────────────────────────────────────────┐
 * │ Auto-merge sensitivity           [Cautious|Balanced|Eager] │
 * │ Check new contacts automatically                     (•) │
 * │ Check imports automatically                          (•) │
 * └──────────────────────────────────────────────────────────┘
 * ```
 *
 * The three settings used to sit in a card above the tool, and the tool
 * opened on a hero with a large icon that repeated the page's title. Merge
 * activity, the history of what was merged and undone, is the square button
 * in the header's corner at every width, the way Ask Contrack's History is.
 *
 * The page is a block in the shell's one scroller, like every settings
 * page, so the shell draws Reset to defaults under it while a setting here
 * is changed.
 *
 * @module views/settings/pages/DuplicatesPage
 */
import React from "react";
import { ArrowRight, Copy, History } from "lucide-react";
import { Link } from "react-router-dom";
import { DedupeView } from "../../dedupe";
import { SettingRow } from "../SettingRow";
import { SettingsHeaderActions } from "../SettingsHeader";
import { Segmented } from "../../../components/ui/Segmented";
import { Switch } from "../../../components/ui/Switch";
import { useDedupeSettings } from "../../../hooks/useDedupeSettings";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useDedupeOptional } from "../../../contexts/DedupeContext";
import { useDedupeCount } from "../../../api";
import { cn } from "../../../lib/utils";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";
import { SettingsCallout } from "../SettingsCallout";

const DEDUPE_PRESET_COPY = {
  conservative:
    "Merges a pair by itself at 97% confidence or more, and leaves the most for you",
  default: "Merges a pair by itself at 93% confidence or more",
  aggressive:
    "Merges a pair by itself at 88% confidence or more, with more to undo",
} as const;

export const DuplicatesPage = () => {
  const { preset, setPreset } = useDedupeSettings();
  const { preferences, setPreference } = usePreferences();
  const dedupe = useDedupeOptional();
  const { data: dedupeData } = useDedupeCount();
  const dedupeCount =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <SettingsHeaderActions>
        <button
          type="button"
          onClick={() => dedupe?.setShowActivity(true)}
          aria-label="Merge activity"
          title="Merge activity"
          aria-haspopup="dialog"
          className="btn-secondary btn-icon shrink-0"
        >
          <History className="w-5 h-5" aria-hidden="true" />
        </button>
      </SettingsHeaderActions>

      {dedupeCount > 0 && (
        <SettingsCallout
          icon={Copy}
          title={`${dedupeCount} possible duplicate${dedupeCount === 1 ? "" : "s"}`}
          body="Pairs that may be the same person, waiting for you to decide"
        >
          <Link to="/pulse/duplicates" className="btn-primary btn-sm">
            Review them
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </SettingsCallout>
      )}

      <DedupeView />

      <section aria-labelledby="automatic-merging">
        <h2 id="automatic-merging" className={SETTINGS_SECTION_HEADING}>
          Automatic merging
        </h2>
        <div className={SETTINGS_CARD}>
          <SettingRow
            id="sensitivity"
            title="Auto-merge sensitivity"
            prefKey="dedupePreset"
            description={`${DEDUPE_PRESET_COPY[preset]}. It applies to scans, imports and new contacts, and every merge can be undone`}
          >
            <Segmented
              label="Auto-merge sensitivity"
              value={preset}
              onChange={setPreset}
              options={[
                { value: "conservative", label: "Cautious" },
                { value: "default", label: "Balanced" },
                { value: "aggressive", label: "Eager" },
              ]}
            />
          </SettingRow>

          <SettingRow
            id="dedupe-on-create"
            title="Check new contacts automatically"
            prefKey="dedupeOnCreate"
            description="A few seconds after you add one"
            inline
          >
            <Switch
              label="Check new contacts automatically"
              checked={preferences.dedupeOnCreate}
              onChange={(next) => setPreference("dedupeOnCreate", next)}
            />
          </SettingRow>

          <SettingRow
            id="dedupe-on-import"
            title="Check imports automatically"
            prefKey="dedupeOnImport"
            description="When each import finishes"
            inline
          >
            <Switch
              label="Check imports automatically"
              checked={preferences.dedupeOnImport}
              onChange={(next) => setPreference("dedupeOnImport", next)}
            />
          </SettingRow>
        </div>
      </section>
    </div>
  );
};

export default DuplicatesPage;
