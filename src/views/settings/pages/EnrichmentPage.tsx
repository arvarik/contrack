/**
 * EnrichmentPage — Research contacts on the web to fill in missing details.
 *
 * Wraps AISearchView with the never-enriched count strip, automatic enrichment
 * switch, and admin grounding meter.
 *
 * @module views/settings/pages/EnrichmentPage
 */
import React, { useMemo, useState } from "react";
import { ArrowRight, Gauge, Sparkles } from "lucide-react";
import { AISearchView } from "../../ai-search";
import { SettingRow } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { useContacts } from "../../../api";
import { useGroundingCapacity } from "../../../api/enrichment";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useAuth } from "../../../components/auth/AuthGate";
import { CARD } from "../../../lib/styles";
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
    <div className="space-y-6">
      <div className="p-4 sm:p-6 md:p-10 max-w-4xl mx-auto space-y-6 pb-0">
        <div className="space-y-1">
          <p className="text-sm text-on-surface-variant">
            Research contacts on the live web and fill in the gaps in their
            profiles.
          </p>
        </div>

        {/* Never-enriched count banner */}
        {neverEnrichedContacts.length > 0 && (
          <div
            className={cn(
              CARD,
              "p-4 flex items-center justify-between gap-4 bg-primary/10 border-primary/20",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <Sparkles className="w-5 h-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-on-surface">
                  {neverEnrichedContacts.length}{" "}
                  {neverEnrichedContacts.length === 1
                    ? "contact has"
                    : "contacts have"}{" "}
                  never been enriched.
                </p>
                <p className="text-xs text-on-surface-variant">
                  Select and run research to fill in employment, websites, and
                  bio details.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleEnrichThem}
              className="btn-primary text-xs px-3 py-2 shrink-0 flex items-center gap-1.5"
            >
              Enrich them
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Settings card */}
        <div
          className={cn(
            CARD,
            "p-4 sm:p-5 divide-y divide-surface-container-high",
          )}
        >
          <SettingRow
            id="auto-enrich"
            title="Enrich new contacts automatically"
            prefKey="autoEnrich"
            description={
              <>
                <span className="block">
                  Uses the Research capability for every contact you add.
                </span>
                <span className="block text-xs text-on-surface-variant mt-1">
                  Each run costs provider quota. Off by default.
                </span>
              </>
            }
          >
            <Switch
              label="Enrich new contacts automatically"
              checked={preferences.autoEnrich}
              onChange={(next) => setPreference("autoEnrich", next)}
            />
          </SettingRow>

          {isAdmin && groundingCapacity && (
            <div
              id="grounding"
              className="pt-4 flex items-center gap-2 text-xs text-on-surface-variant"
            >
              <Gauge className="w-4 h-4 text-on-surface-variant shrink-0" />
              <span>
                Grounding today: {groundingUsed} of {groundingCapacity.limit}{" "}
                used
              </span>
            </div>
          )}
        </div>
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
