/**
 * PrivacyPage — Privacy and AI settings for this account.
 *
 * Controls account-level AI opt-out, explains what stays local on this machine,
 * shows available AI capabilities, and links to AI usage statistics.
 *
 * @module views/settings/pages/PrivacyPage
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, HardDrive, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { SettingRow } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  useSearchHistoryList,
  useClearHistory,
} from "../../../api/searchHistory";
import { AiCapabilitiesCard } from "../AiCapabilitiesCard";
import { SETTINGS_PAGE } from "../layout";
import { CARD, SECTION_HEADING, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

export const PrivacyPage = () => {
  const { preferences, setPreference } = usePreferences();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const { data } = useSearchHistoryList();
  const clearMutation = useClearHistory();

  const count = data?.pages[0]?.total ?? 0;

  const handleClearHistory = () => {
    clearMutation.mutate(undefined, {
      onSuccess: () => {
        setClearDialogOpen(false);
        toast.success("Search history cleared");
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to clear search history",
        );
      },
    });
  };

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-6")}>
      <div className="space-y-1">
        <p className="text-sm text-on-surface-variant">
          AI opt-out, data handling, and available capabilities.
        </p>
      </div>

      <div className={cn(CARD, "p-4 sm:p-6 divide-y divide-surface-container")}>
        <SettingRow
          id="ai-assist"
          title="Use AI for this account"
          prefKey="aiAssist"
          description="Allows Contrack to use configured AI providers for synthesis, enrichment, briefings, and insights. When turned off, no requests are sent to third-party models on your behalf."
        >
          <Switch
            label="Use AI for this account"
            checked={preferences.aiAssist}
            onChange={(next) => setPreference("aiAssist", next)}
          />
        </SettingRow>

        <SettingRow
          id="search-history"
          title="Search history"
          description="Questions asked in Ask Contrack and the command palette are saved for quick recall. You can clear your history across all modes at any time."
        >
          <div className="flex items-center gap-3">
            <span className="text-xs sm:text-sm text-on-surface-variant whitespace-nowrap">
              {count} {count === 1 ? "question" : "questions"}
            </span>
            <button
              type="button"
              disabled={count === 0 || clearMutation.isPending}
              onClick={() => setClearDialogOpen(true)}
              className="btn-secondary btn-sm shrink-0 text-error"
            >
              Clear history
            </button>
          </div>
        </SettingRow>
      </div>

      {/* What stays local */}
      <div className={cn(CARD, "p-4 sm:p-6 space-y-4")}>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
              TONE_WASH.success,
            )}
          >
            <HardDrive className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className={cn(SECTION_HEADING, "text-xs mb-1")}>
              What stays on this machine
            </h2>
            <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
              Contrack is self-hosted and local-first. Your contact information,
              notes, timelines, and search logs are stored on this machine in
              your local SQLite database.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs sm:text-sm text-on-surface-variant">
          <div className="rounded-xl bg-surface-container-low p-3.5 space-y-1">
            <div className="flex items-center gap-2 font-bold text-on-surface">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span>Local search & indexing</span>
            </div>
            <p className="text-pretty">
              Full-text search (SQLite FTS5) and vector search (sqlite-vec) run
              entirely on this server without external network calls.
            </p>
          </div>

          <div className="rounded-xl bg-surface-container-low p-3.5 space-y-1">
            <div className="flex items-center gap-2 font-bold text-on-surface">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span>Third-party AI providers</span>
            </div>
            <p className="text-pretty">
              External providers are only contacted when an AI feature is
              actively used. Turning off AI above halts all outbound model
              requests.
            </p>
          </div>
        </div>
      </div>

      {/* Capabilities and usage link */}
      <div className="space-y-4">
        <AiCapabilitiesCard />

        <div
          className={cn(
            CARD,
            "p-4 sm:p-5 flex items-center justify-between gap-4",
          )}
        >
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-on-surface">
              AI usage & activity
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5 text-pretty">
              Review token consumption, query patterns, and provider requests.
            </p>
          </div>
          <Link
            to="/settings/ai-usage"
            className="btn-secondary btn-sm shrink-0"
          >
            <span>View usage</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <ConfirmDialog
        isOpen={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        onConfirm={handleClearHistory}
        title="Clear search history"
        description={`Delete all ${count} questions? This cannot be undone.`}
        confirmLabel="Delete all"
        busy={clearMutation.isPending}
      />
    </div>
  );
};

export default PrivacyPage;
