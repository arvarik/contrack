/**
 * DuplicatesPage — Find and merge duplicate contacts, automatically or by hand.
 *
 * Wraps DedupeView with the review strip, auto-merge sensitivity, and automatic
 * duplicate checking switches above the deduplication engine.
 *
 * @module views/settings/pages/DuplicatesPage
 */
import React, { useRef } from "react";
import { ArrowRight, Copy } from "lucide-react";
import { DedupeView } from "../../dedupe";
import { SettingRow } from "../SettingRow";
import { Segmented } from "../../../components/ui/Segmented";
import { Switch } from "../../../components/ui/Switch";
import { useDedupeSettings } from "../../../hooks/useDedupeSettings";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useDedupeCount } from "../../../api";
import { CARD } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

const DEDUPE_PRESET_COPY = {
  conservative:
    "Auto-merges only pairs at 97%+ confidence. Fewest merges; most left for review.",
  default: "Auto-merges pairs at 93%+ confidence.",
  aggressive:
    "Auto-merges pairs at 88%+ confidence. Fewer to review; more misfires to undo.",
} as const;

export const DuplicatesPage = () => {
  const { preset, setPreset } = useDedupeSettings();
  const { preferences, setPreference } = usePreferences();
  const { data: dedupeData } = useDedupeCount();
  const dedupeCount =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);
  const engineRef = useRef<HTMLDivElement>(null);

  const handleReviewClick = () => {
    engineRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 sm:p-6 pb-4 shrink-0 max-w-4xl w-full mx-auto overflow-y-auto max-h-[50vh] sm:max-h-none">
        {/* Review strip */}
        {dedupeCount > 0 && (
          <div
            className={cn(
              CARD,
              "p-4 mb-4 flex items-center justify-between gap-4 bg-primary/10 border-primary/20",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <Copy className="w-5 h-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-on-surface">
                  {dedupeCount} possible duplicate{dedupeCount === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-on-surface-variant">
                  Matches found across your contacts that need your
                  confirmation.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReviewClick}
              className="btn-primary text-xs px-3 py-2 shrink-0 flex items-center gap-1.5"
            >
              Review them
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div
          className={cn(
            CARD,
            "p-4 sm:p-5 divide-y divide-surface-container-high",
          )}
        >
          <SettingRow
            id="sensitivity"
            title="Auto-merge sensitivity"
            prefKey="dedupePreset"
            description={
              <>
                <span className="block">{DEDUPE_PRESET_COPY[preset]}</span>
                <span className="block mt-1">
                  Applies to scans you start, to imports, and to the check that
                  runs after you add a contact. Every auto-merge is undoable.
                </span>
              </>
            }
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
            description="Runs a few seconds after you add one."
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
            description="Scans every import when it finishes."
          >
            <Switch
              label="Check imports automatically"
              checked={preferences.dedupeOnImport}
              onChange={(next) => setPreference("dedupeOnImport", next)}
            />
          </SettingRow>
        </div>
      </div>

      <div ref={engineRef} className="flex-1 min-h-0 relative">
        <DedupeView embedded hideBackLink />
      </div>
    </div>
  );
};

export default DuplicatesPage;
