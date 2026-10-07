/**
 * EnrichmentPage: the two settings every research run uses (enrich new
 * contacts, the web search engine), then the research tool.
 *
 * The engine is the account's own when the instance has more than one
 * account. With one, it is the instance's, the same value as Administration
 * → AI → Web search.
 */
import { AISearchView } from "../../ai-search";
import { PrefSwitchRow, SettingRow } from "../SettingRow";
import { useGroundingCapacity } from "../../../api/enrichment";
import { useAISettings } from "../../../api/aiSettings";
import { EngineChoice } from "../EngineChoice";
import { useAuth } from "../../../components/auth/AuthGate";
import { SETTINGS_CARD, SETTINGS_PAGE } from "../layout";
import { cn } from "../../../lib/utils";

export const EnrichmentPage = () => {
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
        <PrefSwitchRow
          id="auto-enrich"
          title="Enrich new contacts automatically"
          prefKey="autoEnrich"
          description="Researches each contact that you add yourself, at Standard depth, with the engine below. Not the contacts from an import, a sync or an MCP client"
        />

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
