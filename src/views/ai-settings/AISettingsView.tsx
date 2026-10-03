import { toast } from "sonner";
import { useAISettings, useSetInstanceAi } from "../../api/aiSettings";
import { Switch } from "../../components/ui/Switch";
import { SettingRow, useHashTarget } from "../settings/SettingRow";
import { cn } from "../../lib/utils";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../settings/layout";
import { FeatureMap } from "./FeatureMap";
import { ProvidersSection } from "./ProvidersSection";
import { ModelsSection } from "./ModelsSection";
import { WebSearchSection } from "./WebSearchSection";

// ---------------------------------------------------------------------------
// AISettingsView — Settings → Administration → AI
// ---------------------------------------------------------------------------
// Every AI setting of the instance, in one place, in the order a person
// reads them:
//
//   1. Use AI on this instance: the switch that overrules everything below.
//   2. What each feature uses: whether each feature works, and what it runs
//      on, with a link from each part to its control. With no provider it
//      is the page's empty state.
//   3. Providers: the keys and the OpenAI-compatible servers.
//   4. Models: the Fast, Strong and embedding models, and the reranker.
//   5. Web search: the switch, the web search model, SearXNG and the engine.
//
// Every model defaults to Automatic, so someone who pastes one key and never
// opens this page gets sensible behavior with zero configuration.
// ---------------------------------------------------------------------------

export const AISettingsView = () => {
  const { data: settings, isLoading } = useAISettings();
  const setInstanceAi = useSetInstanceAi();

  if (isLoading || !settings) {
    return (
      <div className={cn(SETTINGS_PAGE, "text-sm text-on-surface-variant")}>
        Loading AI settings…
      </div>
    );
  }

  /** `on` is the switch's new position: true lets AI run on the instance. */
  const handleInstanceAi = (on: boolean) => {
    setInstanceAi.mutate(!on, {
      onSuccess: () =>
        toast.success(
          on ? "AI is on for this instance" : "AI is off for this instance",
        ),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
    });
  };

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      {/* Above everything, because it overrules everything: while it is off,
        no key below is used, for any account. AI_DISABLED on the server
        holds it off, so the switch cannot turn AI on and says why. */}
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="ai-instance"
          title="Use AI on this instance"
          description={
            <>
              Off sends nothing to any AI provider, for every account. Search on
              this server still works
              {settings.instance.lockedByEnv && (
                <span className="block mt-1 font-medium text-on-surface">
                  Set by <code className="font-mono">AI_DISABLED</code>
                </span>
              )}
            </>
          }
          inline
        >
          <Switch
            label="Use AI on this instance"
            checked={!settings.instance.aiOff}
            disabled={settings.instance.lockedByEnv || setInstanceAi.isPending}
            onChange={handleInstanceAi}
          />
        </SettingRow>
      </div>

      <FeaturesCard />

      <ProvidersSection settings={settings} />
      <ModelsSection settings={settings} />
      <WebSearchSection settings={settings} />
    </div>
  );
};

/**
 * "What each feature uses", as its own component: it mounts once the
 * settings have loaded, so a search result's link to it can scroll to it.
 */
function FeaturesCard() {
  const { ref, flashing } = useHashTarget<HTMLDivElement>("ai-features");
  return (
    <section aria-labelledby="ai-features-heading">
      <h2 id="ai-features-heading" className={SETTINGS_SECTION_HEADING}>
        What each feature uses
      </h2>
      <div
        id="ai-features"
        ref={ref}
        tabIndex={-1}
        className={cn(
          SETTINGS_CARD,
          "scroll-mt-20 outline-none transition-colors duration-(--dur-slow)",
          flashing && "flash bg-primary/10",
        )}
      >
        <FeatureMap scope="instance" />
      </div>
    </section>
  );
}
