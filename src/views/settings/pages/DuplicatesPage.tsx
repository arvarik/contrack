/**
 * DuplicatesPage — Find and merge duplicate contacts, automatically or by hand.
 *
 * Wraps DedupeView with the auto-merge sensitivity row above the engine.
 */
import React from "react";
import { DedupeView } from "../../dedupe";
import { SettingRow } from "../SettingRow";
import { Segmented } from "../../../components/ui/Segmented";
import { useDedupeSettings } from "../../../hooks/useDedupeSettings";
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 sm:p-6 pb-4 shrink-0 max-w-4xl w-full mx-auto">
        <div className={cn(CARD, "p-4 sm:p-5")}>
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
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <DedupeView embedded hideBackLink />
      </div>
    </div>
  );
};

export default DuplicatesPage;
