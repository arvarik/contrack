/**
 * EnrichmentPage — Research contacts on the web to fill in missing details.
 *
 * Wraps AISearchView with the never-enriched count strip, automatic enrichment
 * switch, and admin grounding meter.
 *
 * @module views/settings/pages/EnrichmentPage
 */
import React, { useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { AISearchView } from "../../ai-search";
import { SettingRow } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { useContacts } from "../../../api";
import { useGroundingCapacity } from "../../../api/enrichment";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useAuth } from "../../../components/auth/AuthGate";
import { SETTINGS_CARD, SETTINGS_PAGE } from "../layout";
import { SettingsCallout } from "../SettingsCallout";
import { cn } from "../../../lib/utils";

export const EnrichmentPage = () => {
  const { data: contacts = [] } = useContacts();
  const { preferences, setPreference } = usePreferences();
  const { isAdmin } = useAuth();
  const { data: groundingCapacity } = useGroundingCapacity();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter contacts that have never been enriched
  const neverEnrichedContacts = useMemo(
    () =>
      contacts.filter((c) => !c.aiHydratedAt && !c.isArchived && !c.isGhost),
    [contacts],
  );

  const handleEnrichThem = () => {
    setSelectedIds(new Set(neverEnrichedContacts.map((c) => c.id)));
  };

  const groundingUsed = groundingCapacity
    ? Math.max(0, groundingCapacity.limit - groundingCapacity.remaining)
    : 0;

  return (
    // One box for the whole page, the enrichment list included, so every
    // card starts under the page title.
    <div className={cn(SETTINGS_PAGE, "space-y-6")}>
      {/* Never-enriched count banner */}
      {neverEnrichedContacts.length > 0 && (
        <SettingsCallout
          icon={Sparkles}
          title={`${neverEnrichedContacts.length} ${
            neverEnrichedContacts.length === 1 ? "contact has" : "contacts have"
          } never been enriched`}
          body="Select them to research their work, websites, and bio"
        >
          <button
            type="button"
            onClick={handleEnrichThem}
            className="btn-primary btn-sm"
          >
            Select them
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </SettingsCallout>
      )}

      <div className={SETTINGS_CARD}>
        <SettingRow
          id="auto-enrich"
          title="Enrich new contacts automatically"
          prefKey="autoEnrich"
          description="Researches every contact you add. Each run uses some of the provider's quota"
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
            title="Web searches today"
            description="The provider's daily limit for research on the web, for the whole instance"
            inline
          >
            <span className="text-sm font-bold text-on-surface tabular-nums whitespace-nowrap">
              {groundingUsed} of {groundingCapacity.limit}
            </span>
          </SettingRow>
        )}
      </div>

      <AISearchView
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        hideHeaderDescription
      />
    </div>
  );
};

export default EnrichmentPage;
