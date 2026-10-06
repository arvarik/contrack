/**
 * PrivacyPage — Privacy and AI settings for this account.
 *
 * The AI switch, the search history, what stays on the server, and what
 * each AI feature uses (`FeatureMap`), with a link to AI usage.
 *
 * The switch is the account's own, "Use AI for my account", when the
 * instance has more than one account. With one, that account is the admin
 * and the instance is theirs alone: two switches, one for the account and
 * one for the instance, did the same thing in two places. The page then
 * shows one, "Use AI", which is the instance's switch. Turning it on also
 * turns the account's own back on, so a switch left off before cannot keep
 * AI off unseen.
 *
 * @module views/settings/pages/PrivacyPage
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { useAuth } from "../../../components/auth/AuthGate";
import { SettingRow, useHashTarget } from "../SettingRow";
import { Switch } from "../../../components/ui/Switch";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  useSearchHistoryList,
  useClearHistory,
} from "../../../api/searchHistory";
import { FeatureMap } from "../../ai-settings/FeatureMap";
import {
  useAISettings,
  useInstanceAi,
  useSetInstanceAi,
} from "../../../api/aiSettings";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../layout";
import { cn, errorText } from "../../../lib/utils";
import { TEXT_LINK } from "../../../lib/styles";

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
  // An admin can turn AI off for every account. The account's own switch
  // cannot turn it back on then, so it shows off, cannot be pressed, and
  // says why.
  const { data: instanceAi } = useInstanceAi();
  const instanceOff = instanceAi?.aiOff === true;
  const { data: aiSettings } = useAISettings();
  const setInstanceAi = useSetInstanceAi();
  // One account, the admin: the account's switch is the instance's.
  const soleAccount = isAdmin && aiSettings?.multipleAccounts === false;
  const features = useHashTarget<HTMLDivElement>("ai-features");

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
        toast.error(`Could not clear the search history: ${errorText(err)}`);
      },
    });
  };

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <div className={SETTINGS_CARD}>
        {soleAccount ? (
          <SettingRow
            id="ai-assist"
            title="Use AI"
            description={
              <>
                Off sends nothing to any AI provider. Search on the server still
                works
                {instanceAi?.lockedByEnv && (
                  <span className="block mt-1 font-medium text-on-surface">
                    Set by <code className="font-mono">AI_DISABLED</code>
                  </span>
                )}
              </>
            }
            inline
          >
            <Switch
              label="Use AI"
              checked={!instanceOff && preferences.aiAssist}
              disabled={instanceAi?.lockedByEnv || setInstanceAi.isPending}
              onChange={(on) => {
                if (!on) {
                  setInstanceAi.mutate(true, {
                    onSuccess: () => toast.success("AI is off"),
                    onError: (err) => toast.error(err.message),
                  });
                  return;
                }
                if (!preferences.aiAssist) setPreference("aiAssist", true);
                if (instanceOff)
                  setInstanceAi.mutate(false, {
                    onSuccess: () => toast.success("AI is on"),
                    onError: (err) => toast.error(err.message),
                  });
              }}
            />
          </SettingRow>
        ) : (
          <SettingRow
            id="ai-assist"
            title="Use AI for my account"
            prefKey="aiAssist"
            description={
              <>
                Off sends nothing to an AI provider for you. Search on this
                server still works
                {instanceOff && (
                  <span className="block mt-1 font-medium text-on-surface">
                    An admin turned AI off for everyone on this instance
                  </span>
                )}
              </>
            }
            inline
          >
            <Switch
              label="Use AI for my account"
              checked={preferences.aiAssist && !instanceOff}
              disabled={instanceOff}
              onChange={(next) => setPreference("aiAssist", next)}
            />
          </SettingRow>
        )}

        <SettingRow
          id="search-history"
          title="Search history"
          description="What you ask in Ask Contrack and the command palette is kept, so you can ask it again"
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
          What stays on the server
        </h2>
        <div className={cn(SETTINGS_CARD, "space-y-4")}>
          <p className="text-sm text-on-surface-variant text-pretty">
            Contrack runs on your own server, and keeps your contacts, notes and
            searches in its own database
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Fact icon={ShieldCheck} title="Search runs here">
              Full-text search and search by meaning run on the server, with no
              call to anyone else
            </Fact>
            <Fact
              icon={ShieldCheck}
              title="AI providers hear only what you ask"
            >
              A provider hears from Contrack only when you use an AI feature.
              With AI off above, it hears nothing
            </Fact>
          </div>
        </div>
      </section>

      <section aria-labelledby="privacy-ai">
        <h2 id="privacy-ai" className={SETTINGS_SECTION_HEADING}>
          What each feature uses
        </h2>
        <div
          id="ai-features"
          ref={features.ref}
          tabIndex={-1}
          className={cn(
            SETTINGS_CARD,
            "space-y-4 scroll-mt-20 outline-none transition-colors duration-(--dur-slow)",
            features.flashing && "flash bg-primary/10",
          )}
        >
          <p className="text-sm text-on-surface-variant text-pretty">
            {isAdmin ? (
              <>
                The models and web search for everyone here.{" "}
                <Link to="/settings/admin/ai" className={TEXT_LINK}>
                  Change them in Settings → Administration → AI
                </Link>
              </>
            ) : (
              "An admin sets these up for everyone here"
            )}
          </p>
          <FeatureMap scope="account" />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-sm text-on-surface-variant text-pretty">
              How much AI you used, and what it cost
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
        description={`This deletes all ${questions} you asked. It cannot be undone`}
        confirmLabel="Clear history"
        busy={clearMutation.isPending}
      />
    </div>
  );
};

export default PrivacyPage;
