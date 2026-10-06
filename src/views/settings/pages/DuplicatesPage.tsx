/**
 * DuplicatesPage: the check and the manual merge first, then the automatic
 * merging settings. The header's Merge history button carries its name,
 * because the Undo a merge needs must not hide behind a glyph.
 */
import { ArrowRight, Copy, History } from "lucide-react";
import { Link } from "react-router-dom";
import { DedupeView } from "../../dedupe";
import { PrefSwitchRow, SettingRow } from "../SettingRow";
import { SettingsHeaderActions } from "../SettingsHeader";
import { Segmented } from "../../../components/ui/Segmented";
import { useDedupeSettings } from "../../../hooks/useDedupeSettings";
import { NAMES } from "../../../lib/names";
import { useDedupeCount } from "../../../api";
import { cn } from "../../../lib/utils";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";
import { SettingsCallout } from "../SettingsCallout";

/**
 * What each preset merges by itself, in matches a person knows rather than
 * the confidence each needs (97%, 93% and 88% in
 * server/services/dedupe/policy.ts).
 */
const DEDUPE_PRESET_COPY = {
  conservative:
    "Merges by itself only when two contacts share an email address. The rest wait for you",
  default:
    "Merges by itself on a shared email, phone number or profile link, or the same name at the same company",
  aggressive:
    "Also merges the same name, a nickname or a middle name added, when nothing argues against it. More to undo",
} as const;

export const DuplicatesPage = () => {
  const { preset, setPreset } = useDedupeSettings();
  const { data: dedupeData } = useDedupeCount();
  const dedupeCount =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <SettingsHeaderActions>
        <Link
          to="/pulse/duplicates?view=merged"
          className="btn-secondary shrink-0"
        >
          <History className="w-4 h-4" aria-hidden="true" />
          {NAMES.mergeHistory.label}
        </Link>
      </SettingsHeaderActions>

      {dedupeCount > 0 && (
        <SettingsCallout
          icon={Copy}
          title={`${dedupeCount} possible duplicate${dedupeCount === 1 ? "" : "s"}`}
          body="Contacts that may be the same person, waiting for you to decide"
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
            description={`${DEDUPE_PRESET_COPY[preset]}. It applies to checks, imports and new contacts, and every merge can be undone`}
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

          <PrefSwitchRow
            id="dedupe-on-create"
            title="Check new contacts automatically"
            prefKey="dedupeOnCreate"
            description="A few seconds after you add one"
          />

          <PrefSwitchRow
            id="dedupe-on-import"
            title="Check imports automatically"
            prefKey="dedupeOnImport"
            description="When each import finishes"
          />
        </div>
      </section>
    </div>
  );
};

export default DuplicatesPage;
