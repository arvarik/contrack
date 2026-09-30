/**
 * EnrichmentPage — Research contacts on the web to fill in missing details.
 *
 * Wraps AISearchView with the automatic enrichment switch and the admin
 * grounding meter.
 *
 * @module views/settings/pages/EnrichmentPage
 */
import { AISearchView } from "../../ai-search";
import { SettingRow } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { useGroundingCapacity } from "../../../api/enrichment";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useAuth } from "../../../components/auth/AuthGate";
import { SETTINGS_CARD, SETTINGS_PAGE } from "../layout";
import { cn } from "../../../lib/utils";

export const EnrichmentPage = () => {
  const { preferences, setPreference } = usePreferences();
  const { isAdmin } = useAuth();
  const { data: groundingCapacity } = useGroundingCapacity();

  return (
    // One box for the whole page, the enrichment list included, so every
    // card starts under the page title.
    <div className={cn(SETTINGS_PAGE, "space-y-6")}>
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="auto-enrich"
          title="Enrich new contacts automatically"
          prefKey="autoEnrich"
          description="Researches each contact that you add yourself, at Standard depth. Not the contacts from an import, a sync or an MCP client"
          inline
        >
          <Switch
            label="Enrich new contacts automatically"
            checked={preferences.autoEnrich}
            onChange={(next) => setPreference("autoEnrich", next)}
          />
        </SettingRow>

        {isAdmin && groundingCapacity && (
          <SettingRow
            id="grounding"
            title="Research runs, last 24 hours"
            description="Web research for the whole instance. The provider bills each run"
            inline
          >
            <span className="text-sm font-bold text-on-surface tabular-nums whitespace-nowrap">
              {groundingCapacity.researchRuns24h}
            </span>
          </SettingRow>
        )}
      </div>

      <AISearchView hideHeaderDescription />
    </div>
  );
};

export default EnrichmentPage;
