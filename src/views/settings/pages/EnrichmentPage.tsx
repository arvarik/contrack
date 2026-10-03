/**
 * EnrichmentPage — Research contacts on the web to fill in missing details.
 *
 * The page's settings first, then its tool. The settings are the two that
 * every start uses: "Enrich new contacts automatically" and the web search
 * engine (`EngineChoice`), with the admin's research count. The tool below
 * them (AISearchView) chooses a depth and contacts for one batch.
 *
 * The engine is the account's own when the instance has more than one
 * account. With one, it is the instance's, the same value as Administration
 * → AI → Web search, so it is one choice wherever it is shown.
 *
 * @module views/settings/pages/EnrichmentPage
 */
import { AISearchView } from "../../ai-search";
import { SettingRow } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { useGroundingCapacity } from "../../../api/enrichment";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useAISettings } from "../../../api/aiSettings";
import { EngineChoice } from "../EngineChoice";
import { useAuth } from "../../../components/auth/AuthGate";
import { SETTINGS_CARD, SETTINGS_PAGE } from "../layout";
import { cn } from "../../../lib/utils";

export const EnrichmentPage = () => {
  const { preferences, setPreference } = usePreferences();
  const { isAdmin } = useAuth();
  const { data: groundingCapacity } = useGroundingCapacity();
  const { data: aiSettings } = useAISettings();
  // The account's own engine, a preference with a default, only when it is
  // not the instance's.
  const ownEngine = !!aiSettings?.multipleAccounts || !isAdmin;

  return (
    // One box for the whole page, the enrichment list included, so every
    // card starts under the page title.
    <div className={cn(SETTINGS_PAGE, "space-y-6")}>
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="auto-enrich"
          title="Enrich new contacts automatically"
          prefKey="autoEnrich"
          description="Researches each contact that you add yourself, at Standard depth, with the engine below. Not the contacts from an import, a sync or an MCP client"
          inline
        >
          <Switch
            label="Enrich new contacts automatically"
            checked={preferences.autoEnrich}
            onChange={(next) => setPreference("autoEnrich", next)}
          />
        </SettingRow>

        <SettingRow
          id="web-search-engine"
          title="Web search engine"
          prefKey={ownEngine ? "webSearchEngine" : undefined}
          description="What contact research searches the web with"
          below
        >
          <EngineChoice scope="account" />
        </SettingRow>

        {isAdmin && groundingCapacity && (
          <SettingRow
            id="grounding"
            title="Research runs, last 24 hours"
            description="Contact research for everyone on this instance"
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
