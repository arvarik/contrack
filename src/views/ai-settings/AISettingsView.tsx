import { toast } from "sonner";
import { useAISettings, useSetInstanceAi } from "../../api/aiSettings";
import { Switch } from "../../components/ui/Switch";
import { SettingRow, useHashTarget } from "../settings/SettingRow";
import { cn, errorText } from "../../lib/utils";
import {
  SETTINGS_CARD,
  SETTINGS_PAGE,
  SETTINGS_SECTION_HEADING,
} from "../settings/layout";
import { FeatureMap } from "./FeatureMap";
import { ProvidersSection } from "./ProvidersSection";
import { ModelsSection } from "./ModelsSection";
import { WebSearchSection } from "./WebSearchSection";

// Settings → Administration → AI: every AI setting of the instance, in reading
// order. Every model defaults to Automatic, so one pasted key works with no
// other setup.

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
        toast.error(
          `Could not turn AI ${on ? "on" : "off"}: ${errorText(err)}`,
        ),
    });
  };

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      {/* First, because it overrules everything below. AI_DISABLED on the
          server locks it off, and the row says why. */}
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="ai-instance"
          title="Use AI on this instance"
          description={
            <>
              Off sends nothing to any AI provider, for every account. Search on
              the server still works
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
