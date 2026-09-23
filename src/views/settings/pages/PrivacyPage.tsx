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
import { ArrowRight, ShieldCheck, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useAuth } from "../../../components/auth/AuthGate";
import { SettingRow } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  useSearchHistoryList,
  useClearHistory,
} from "../../../api/searchHistory";
import { AiCapabilitiesList } from "../AiCapabilitiesCard";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";
import { cn } from "../../../lib/utils";

/** One fact about where data lives: a static tile on the card's wash. */
const Fact = ({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-xl bg-surface-container-low p-3.5 space-y-1">
    <p className="flex items-center gap-2 text-sm font-bold text-on-surface">
      <Icon aria-hidden="true" className="w-4 h-4 text-primary shrink-0" />
      {title}
    </p>
    <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
      {children}
    </p>
  </div>
);

export const PrivacyPage = () => {
  const { preferences, setPreference } = usePreferences();
  const { isAdmin } = useAuth();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const { data } = useSearchHistoryList();
  const clearMutation = useClearHistory();

  const count = data?.pages[0]?.total ?? 0;
  const questions = `${count} ${count === 1 ? "question" : "questions"}`;
  // An admin's usage page is the one under Administration, which covers
  // every account and has "Mine" as one of its views.
  const usagePath = isAdmin ? "/settings/admin/ai-usage" : "/settings/ai-usage";

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
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="ai-assist"
          title="Use AI for this account"
          prefKey="aiAssist"
          description="Lets Contrack use the AI providers set up here for summaries, enrichment, briefings, and insights. When it is off, Contrack sends nothing to an AI provider for you."
          inline
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
          description="What you ask in Ask Contrack and the command palette is kept, so you can ask it again."
        >
          <div className="flex items-center gap-3">
            <span className="text-xs sm:text-sm text-on-surface-variant whitespace-nowrap">
              {questions}
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

      <section aria-labelledby="privacy-local">
        <h2 id="privacy-local" className={SETTINGS_SECTION_HEADING}>
          What stays on this machine
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-4")}>
          <p className="text-sm text-on-surface-variant text-pretty">
            Contrack runs on your own server. Your contacts, notes, timelines,
            and searches are kept there, in its SQLite database.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Fact icon={ShieldCheck} title="Search runs here">
              Full-text search and search by meaning run on this server, with no
              call to anyone else.
            </Fact>
            <Fact
              icon={ShieldCheck}
              title="AI providers hear only what you ask"
            >
              A provider hears from Contrack only when you use an AI feature.
              With AI off above, it hears nothing.
            </Fact>
          </div>
        </div>
      </section>

      <section aria-labelledby="privacy-ai">
        <h2 id="privacy-ai" className={SETTINGS_SECTION_HEADING}>
          AI on this instance
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-4")}>
          <p className="text-sm text-on-surface-variant text-pretty">
            An administrator sets these up for everyone here.
          </p>
          <AiCapabilitiesList />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-sm text-on-surface-variant text-pretty">
              How much AI you used, and what it cost.
            </p>
            <Link to={usagePath} className="btn-secondary btn-sm shrink-0">
              View usage
              <ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      <ConfirmDialog
        isOpen={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        onConfirm={handleClearHistory}
        title="Clear search history?"
        description={`This deletes all ${questions} you asked. It cannot be undone.`}
        confirmLabel="Clear history"
        busy={clearMutation.isPending}
      />
    </div>
  );
};

export default PrivacyPage;
