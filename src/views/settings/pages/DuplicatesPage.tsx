/**
 * DuplicatesPage — Find and merge duplicate contacts, automatically or by hand.
 *
 * Wraps DedupeView with the review strip, auto-merge sensitivity, and automatic
 * duplicate checking switches above the deduplication engine.
 *
 * @module views/settings/pages/DuplicatesPage
 */
import React from "react";
import { ArrowRight, Copy } from "lucide-react";
import { Link } from "react-router-dom";
import { DedupeView } from "../../dedupe";
import { SettingRow } from "../SettingRow";
import { Segmented } from "../../../components/ui/Segmented";
import { Switch } from "../../../components/ui/Switch";
import { useDedupeSettings } from "../../../hooks/useDedupeSettings";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useDedupeCount } from "../../../api";
import { CARD, PAGE_X, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

const DEDUPE_PRESET_COPY = {
  conservative:
    "Auto-merges only pairs at 97%+ confidence. Fewest merges; most left for review.",
  default: "Auto-merges pairs at 93%+ confidence.",
  aggressive:
    "Auto-merges pairs at 88%+ confidence. Fewer to review; more misfires to undo.",
} as const;

/**
 * The page's one column: the cards' width, starting on the title's line. The
 * shell's header spans the column (this page owns its scrolling), so the
 * column does not centre. The settings card and the dedupe tool both sit in
 * it, so the page has one left edge and one width at every size.
 */
const COLUMN = "max-w-4xl w-full";

export const DuplicatesPage = () => {
  const { preset, setPreset } = useDedupeSettings();
  const { preferences, setPreference } = usePreferences();
  const { data: dedupeData } = useDedupeCount();
  const dedupeCount =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className={cn(
          PAGE_X,
          COLUMN,
          "pt-4 pb-4 shrink-0 overflow-y-auto max-h-[50vh] sm:max-h-none",
        )}
      >
        {/* Review strip */}
        {dedupeCount > 0 && (
          <div
            className={cn(
              CARD,
              "p-4 mb-4 flex items-center justify-between gap-4 bg-primary/10",
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn("p-2 rounded-lg shrink-0", TONE_WASH.primary)}
              >
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
            <Link
              to="/pulse/duplicates"
              className="btn-primary btn-sm shrink-0"
            >
              Review them
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
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

      {/* The same column. The tool's rows carry their own gutters. */}
      <div className={cn(COLUMN, "flex-1 min-h-0 relative")}>
        <DedupeView />
      </div>
    </div>
  );
};

export default DuplicatesPage;
